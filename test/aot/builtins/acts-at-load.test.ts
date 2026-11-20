// A compiled program may put off the load of a module of Bun until something reads it, but only where no program can tell when the load ran.
// src/codegen/builtins/data/acts-at-load.txt says of every module that has JavaScript source what its load does that a program can see, and the
// next edit under src/js can make it false. So this makes the list again: acts-at-load.fixture.js imports one module in a process that has
// loaded nothing, once in the main thread and once in a Worker, and says what it saw. A line has every kind that either place showed.
//
// AOT_BUILTINS_UPDATE=1 rewrites the file in place of comparing, as test/aot/tools/update-expectations.ts does.
//
// A debug build asks the environment for the names of its own logs at every load (src/codegen/client-js.ts). Those names do not count.
//
// A read counts where a compiled program can put something else in place of what is read. A line names each such read as the table of
// built-ins of the Bun under test spells it (`reads:Date.now`): the compiler holds the names against what a program replaces. A read of
// what the table does not name is the plain kind `reads`. What a load reads of another module is there only once that module is loaded, so
// reads-of-another-module.fixture.js loads two modules a run. That is asked of a module whose line has nothing else that keeps its load
// where it is, and not of a debug build or one with a sanitizer, which start too slowly for that many runs: there a line may name more
// reads than were seen, and the variable rewrites nothing.
//
// The lines are made on Linux, and CI runs this file there alone. On another platform a load may do more or less, and nobody has run this
// there. What it does there: a kind that the load shows must be on the line, plain or with the mark of the platform (`env@win32`), a kind
// with that mark must show, and a plain kind that does not show is let pass. With the variable set it rewrites the marks of that
// platform and nothing else. To hold macOS and Windows to the list, add "aot/builtins/acts-at-load" to `aotTestsThatAskTheSystem` in
// scripts/runner.node.ts.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { runtimeModuleSources } from "../../../src/codegen/builtins/collect-modules";
import { run } from "../harness/run";
import { test } from "../supported";

const repository = join(import.meta.dir, "../../..");
const fileName = "src/codegen/builtins/data/acts-at-load.txt";
const dataFile = join(repository, fileName);
const fixture = join(import.meta.dir, "acts-at-load.fixture.js");
const fixtureOfTwo = join(import.meta.dir, "reads-of-another-module.fixture.js");
const mark = "acts-at-load: ";

// In the order of a line. Behind them the reads that have a name, in the order of their names.
const kinds = ["env", "warns", "listens", "cache", "global", "channel", "throws", "reads", "tick", "chain"] as const;
const named = "reads:";
type Kind = (typeof kinds)[number] | `reads:${string}`;
const isNamedRead = (kind: string): kind is `reads:${string}` => kind.startsWith(named) && kind.length > named.length;
const isKind = (kind: string): kind is Kind => (kinds as readonly string[]).includes(kind) || isNamedRead(kind);
const rankOf = (kind: Kind) => (isNamedRead(kind) ? kinds.length : (kinds as readonly string[]).indexOf(kind));
const places = ["main", "worker"] as const;
type Place = (typeof places)[number];
const namesOfPlaces: Record<Place, string> = { main: "the main thread", worker: "a Worker" };
// Where the file is made. A kind without a mark is what a load does there.
const reference = "linux";

/** One word of a line: a kind, and the platform that alone shows it if it has a mark. */
interface Word {
  kind: Kind;
  platform?: string;
}
interface Line {
  words: Word[];
  /** Behind ` # `. */
  comment?: string;
}
interface List {
  /** The comment lines at the top, as they are written. */
  head: string[];
  lines: Map<string, Line>;
}

const textOfWord = ({ kind, platform }: Word) => (platform === undefined ? kind : `${kind}@${platform}`);
function textOfLine({ words, comment }: Line): string {
  const texts = words.map(textOfWord);
  return (comment === undefined ? texts : [...texts, `# ${comment}`]).join(" ");
}
function inOrder(words: Word[]): Word[] {
  const keyOf = (word: Word) => `${word.kind}@${word.platform ?? ""}`;
  return words.toSorted(
    (left, right) => rankOf(left.kind) - rankOf(right.kind) || (keyOf(left) < keyOf(right) ? -1 : 1),
  );
}

function parseList(text: string): List {
  const all = text.split("\n");
  if (all.pop() !== "") throw new Error(`${fileName}: the file does not end in a newline`);
  const firstLine = all.findIndex(line => !line.startsWith("#"));
  const head = all.slice(0, firstLine === -1 ? all.length : firstLine);
  const lines = new Map<string, Line>();
  let previous: string | undefined;
  for (const [index, written] of all.entries()) {
    if (index < head.length) continue;
    const fail = (problem: string) => new Error(`${fileName}:${index + 1}: ${problem}`);
    const [before, ...behind] = written.split(" # ");
    const [specifier, ...texts] = before.split(" ");
    const hasSpecifier = specifier !== "" && !specifier.startsWith("#");
    if (!hasSpecifier || texts.includes("")) throw fail("a specifier, then kinds, one blank between");
    if (previous !== undefined && previous >= specifier) throw fail(`${specifier} is not in ascending order`);
    previous = specifier;
    const words = texts.map((word): Word => {
      const [kind, platform, ...rest] = word.split("@");
      const isWord = isKind(kind) && rest.length === 0 && platform !== "";
      if (!isWord || platform === reference) throw fail(`${word} is no kind, or a kind with a mark that no line has`);
      return platform === undefined ? { kind } : { kind, platform };
    });
    const isInOrder = textOfLine({ words: inOrder(words) }) === textOfLine({ words });
    if (!isInOrder || new Set(texts).size !== texts.length) {
      throw fail(
        `the kinds are in the order ${kinds.join(" ")}, each once, and the named reads behind them in the order of their names`,
      );
    }
    const plain = new Set(words.flatMap(word => (word.platform === undefined ? [word.kind] : [])));
    if (words.some(word => word.platform !== undefined && plain.has(word.kind))) {
      throw fail("a kind is plain or has marks, not both");
    }
    lines.set(specifier, behind.length > 0 ? { words, comment: behind.join(" # ") } : { words });
  }
  return { head, lines };
}

function formatList({ head, lines }: List): string {
  const written = [...lines].sort(([left], [right]) => (left < right ? -1 : 1));
  const texts = written.map(([specifier, line]) => [specifier, textOfLine(line)].filter(Boolean).join(" "));
  return [...head, ...texts].join("\n") + "\n";
}

/** What the fixture prints, and what the process printed beside it. */
interface Observation {
  threw: string | null;
  environment: string[];
  read: string[];
  called: string[];
  written: string[];
  listeners: string[];
  cache: string[];
  channels: string[];
  tick: boolean;
  timers: number;
  chain: boolean;
  shape: string;
  rows?: Record<string, string[]>;
  loop: Record<string, number | boolean>;
  stdout: string;
  stderr: string;
}
/** For each kind that a load showed, what was seen of it. */
type Seen = Map<Kind, string[]>;

// src/codegen/client-js.ts: what the logs of a debug build ask for. Windows asks in capitals.
const askedByADebugBuildAlone = /^(?:BUN_DEBUG_|DEBUG_)|^(?:SHOW_PID|TRACE)$/i;
const readsOfTheEnvironment = new Set(["process.env", "process.argv", "process.execArgv"]);

function differencesOfShape(before: Record<string, string[]>, after: Record<string, string[]>): string[] {
  const differences: string[] = [];
  for (const path of Object.keys(before)) {
    // What an object holds that is new or gone, the row of its holder says.
    if (after[path] === undefined) continue;
    const [was, is] = [new Set(before[path]), new Set(after[path])];
    const changed = [...after[path].filter(entry => !was.has(entry)), ...before[path].filter(entry => !is.has(entry))];
    differences.push(...new Set(changed.map(entry => `${path}.${entry.split(" ")[0]}`)));
  }
  return differences;
}

/** What a read of a path counts as: nothing where no program can replace what is read, else its name in the table, or "reads". */
type KindOfRead = (path: string) => Kind | null;

function kindsSeen(seen: Observation, unloaded: Observation, kindOfRead: KindOfRead): Seen {
  const found: Seen = new Map();
  const add = (kind: Kind, what: string[]) => {
    if (what.length > 0) found.set(kind, [...(found.get(kind) ?? []), ...what]);
  };
  const asked = seen.environment.filter(name => !askedByADebugBuildAlone.test(name));
  add(
    "env",
    asked.map(name => (name === "*" ? "every name" : name)),
  );
  add(
    "env",
    seen.read.filter(path => readsOfTheEnvironment.has(path)),
  );
  // The fixture notes the calls of console, of process.emitWarning and of addEventListener.
  const called = seen.called.map(path => `${path}()`);
  add(
    "warns",
    called.filter(call => call !== "addEventListener()"),
  );
  if (seen.stdout !== unloaded.stdout) add("warns", [`stdout: ${JSON.stringify(seen.stdout.slice(0, 100))}`]);
  if (seen.stderr !== unloaded.stderr) add("warns", [`stderr: ${JSON.stringify(seen.stderr.slice(0, 100))}`]);
  add(
    "listens",
    called.filter(call => call === "addEventListener()"),
  );
  add(
    "listens",
    seen.listeners.map(name => `process.on("${name}")`),
  );
  if (seen.timers !== 0) add("listens", [`${seen.timers} timers`]);
  const waitedFor = Object.keys(seen.loop).filter(name => seen.loop[name] !== unloaded.loop[name]);
  add(
    "listens",
    waitedFor.map(name => `${name} of the event loop is ${seen.loop[name]}`),
  );
  add("cache", seen.cache);
  add("global", seen.written);
  if (seen.shape !== unloaded.shape) add("global", differencesOfShape(unloaded.rows!, seen.rows!));
  add("channel", seen.channels);
  if (seen.threw !== null) add("throws", [seen.threw]);
  for (const path of seen.read) {
    const kind = readsOfTheEnvironment.has(path) ? null : kindOfRead(path);
    if (kind !== null) add(kind, [path]);
  }
  if (seen.tick) add("tick", ["the queue of process.nextTick"]);
  if (seen.chain) add("chain", ["the prototype above that of process"]);
  return found;
}

const tell = (found: Seen) =>
  Array.from(found, ([kind, what]) => `${kind}: ${[...new Set(what)].slice(0, 8).join(", ")}`).join("; ");

// The environment of a run: only what Bun itself reads when it starts, so that no name a module might ask for is set. The fixture says why.
const passedOn = /^(?:BUN_DEBUG_.*|[A-Z]+SAN_OPTIONS|Malloc|SystemRoot)$/i;
const environment: Record<string, string | undefined> = {};
for (const name of Object.keys(bunEnv)) if (passedOn.test(name)) environment[name] = bunEnv[name];

// No more runs at once than this, however many tests ask: with a sanitizer the tests of a file run beside one another.
let free = Math.min(8, availableParallelism());
const waiting: (() => void)[] = [];
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

async function observe(folder: string, place: Place, specifier: string, shape: string): Promise<Observation> {
  const command = [bunExe(), "--expose-internals", fixture, place, specifier, shape];
  const { stdout, stderr, exitCode } = await inTurn(() => run(command, folder, environment, 60_000));
  const lines = stdout.split("\n");
  const printed = lines.findIndex(line => line.startsWith(mark));
  if (printed === -1) {
    throw new Error(`${specifier} in ${namesOfPlaces[place]}: exit code ${exitCode}\n${stdout}\n${stderr}`);
  }
  const [line] = lines.splice(printed, 1);
  return { ...JSON.parse(line.slice(mark.length)), stdout: lines.join("\n"), stderr };
}

/** Asks the table of built-ins of the Bun under test what a read of each path counts as. */
function readsByTheTable(): KindOfRead {
  const entries = aotBuiltinEntries().entries;
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  const byToken = new Map(entries.map(entry => [entry.token, entry]));
  // `node:buffer.Buffer.from` is `Buffer.from`: the table lists the members of an object under one of its paths.
  const find = (path: string) => {
    for (let end = path.length; end > 0; end = path.lastIndexOf(".", end - 1)) {
      const holder = byPath.get(path.slice(0, end));
      if (end === path.length && holder !== undefined) return holder;
      const same = holder?.sameObjectAs == null ? undefined : byToken.get(holder.sameObjectAs);
      if (same !== undefined) return byPath.get(same.path + path.slice(end));
    }
    return undefined;
  };
  return path => {
    const entry = find(path);
    if (entry === undefined) return "reads";
    return entry.mutability === "AlwaysLocked" ? null : `${named}${entry.path}`;
  };
}

/** Runs the fixture for each load and says what each showed, in the order of `loads`. */
async function sweep(folder: string, loads: (readonly [specifier: string, place: Place])[]): Promise<Seen[]> {
  const kindOfRead = readsByTheTable();
  const unloaded = {} as Record<Place, Observation>;
  for (const place of places) {
    unloaded[place] = await observe(folder, place, "-", "-");
    const found = kindsSeen(unloaded[place], unloaded[place], kindOfRead);
    if (found.size > 0) throw new Error(`a run that loads nothing in ${namesOfPlaces[place]} saw: ${tell(found)}`);
  }
  return await Promise.all(
    loads.map(async ([specifier, place]) => {
      const observed = await observe(folder, place, specifier, unloaded[place].shape);
      return kindsSeen(observed, unloaded[place], kindOfRead);
    }),
  );
}

const kindsShown = (seen: Record<Place, Seen>) =>
  inOrder([...new Set(places.flatMap(place => [...seen[place].keys()]))].map(kind => ({ kind }))).map(
    word => word.kind,
  );

/** The line that the platform of this run makes of what it saw, and of what the file says of the other platforms. */
function lineOf(seen: Record<Place, Seen>, listed: Line | undefined, platform: string): Line {
  const shown = kindsShown(seen);
  const words = listed?.words ?? [];
  const ofOthers = words.filter(word => word.platform !== undefined && word.platform !== platform);
  if (platform !== reference) {
    const plain = words.filter(word => word.platform === undefined);
    const marked = shown.filter(kind => !plain.some(word => word.kind === kind)).map(kind => ({ kind, platform }));
    return { ...listed, words: inOrder([...plain, ...marked, ...ofOthers]) };
  }
  // Which of its reads a place makes, the line does not say.
  const inOnePlace = shown.flatMap(kind => {
    const where = places.filter(place => seen[place].has(kind));
    return where.length === 1 && !isNamedRead(kind) ? [`${kind} in ${namesOfPlaces[where[0]]} only`] : [];
  });
  const made = inOrder([...shown.map(kind => ({ kind })), ...ofOthers.filter(word => !shown.includes(word.kind))]);
  return inOnePlace.length > 0 ? { words: made, comment: inOnePlace.join(", ") } : { words: made };
}

/**
 * Whether a line says what this platform showed: all of it on Linux, and elsewhere what the top of this file says. Where no two modules
 * were loaded in one run, a line may name more reads than were seen.
 */
function agrees(listed: Line | undefined, seen: Record<Place, Seen>, platform: string, sawEveryRead = true): boolean {
  if (listed === undefined) return false;
  if (platform === reference && !sawEveryRead) {
    const made = lineOf(seen, listed, platform).words.map(textOfWord);
    const written = listed.words.map(textOfWord);
    const isSeen = (word: string) => made.includes(word);
    return made.every(word => written.includes(word)) && written.every(word => isNamedRead(word) || isSeen(word));
  }
  if (platform === reference) return textOfLine(listed) === textOfLine(lineOf(seen, listed, platform));
  const shown = kindsShown(seen);
  const mayShow = listed.words.filter(word => word.platform === undefined || word.platform === platform);
  const mustShow = listed.words.filter(word => word.platform === platform);
  const showsNoMore = shown.every(kind => mayShow.some(word => word.kind === kind));
  return showsNoMore && mustShow.every(word => shown.includes(word.kind));
}

/** "<specifier>: listed <kinds>, observed <kinds>", and what was seen of each kind that the line does not have. */
function difference(specifier: string, listed: Line | undefined, seen: Record<Place, Seen>, platform: string): string {
  const isListed = (kind: Kind) => listed?.words.some(word => word.kind === kind);
  const [inMain, inWorker] = places.map(place => tell(new Map([...seen[place]].filter(([kind]) => !isListed(kind)))));
  const shownAnew =
    inMain === inWorker
      ? [inMain]
      : [inMain && `in ${namesOfPlaces.main}: ${inMain}`, inWorker && `in ${namesOfPlaces.worker}: ${inWorker}`];
  const observed = platform === reference ? textOfLine(lineOf(seen, listed, platform)) : kindsShown(seen).join(" ");
  return [
    `${specifier}: listed ${listed === undefined ? "no line" : textOfLine(listed) || "nothing"},`,
    `observed ${observed || "nothing"}`,
    ...(platform === reference ? [] : [`on ${platform}`]),
    ...shownAnew.filter(Boolean).map(what => `(${what})`),
  ].join(" ");
}

// What a program can import and has JavaScript source. The other modules are native: no JavaScript of theirs runs when they are loaded.
const onlyForBunsOwnTests = new Set(["internal/test/binding"]);
/** Every module of Bun that a program can import, the native ones too. */
function importableModules(): string[] {
  const rust = readFileSync(join(repository, "src/resolve_builtins/HardcodedModule.rs"), "utf8");
  const importable = new Set(Array.from(rust.matchAll(/#\[strum\(serialize = "([^"]+)"\)\]/g), match => match[1]));
  const ofBun = runtimeModuleSources().map(({ specifier }) => specifier);
  return ofBun.filter(specifier => importable.has(specifier) && !onlyForBunsOwnTests.has(specifier)).sort();
}
function importableModulesWithSource(): string[] {
  const withSource = new Set(
    runtimeModuleSources().flatMap(({ specifier, hasSource }) => (hasSource ? [specifier] : [])),
  );
  return importableModules().filter(specifier => withSource.has(specifier));
}

const text = readFileSync(dataFile, "utf8");
const list = parseList(text);
const specifiers = importableModulesWithSource();
const modulesOfBun = importableModules();

// A debug build and one with a sanitizer take about a second to start, and this is some thousand runs.
const asksWhatALoadReadsOfOtherModules = process.platform === reference && !isDebug && !isASAN;
/**
 * Whether nothing but a read that has a name keeps the load of the module where it is: the host asks of each such name, where the
 * importer links, whether a program can write it (src/jsc/bindings/InternalModuleRegistry.cpp). Only of such a module the second
 * fixture is asked.
 */
function mayLoadLate(specifier: string, seen: Record<Place, Seen>): boolean {
  return specifier.startsWith("node:") && kindsShown(seen).every(isNamedRead);
}

/** What the load of `second` reads and writes of each other module, as kinds. */
async function readsOfOtherModules(folder: string, second: string, kindOfRead: KindOfRead): Promise<Seen> {
  const found: Seen = new Map();
  const add = (kind: Kind, what: string) => found.set(kind, [...(found.get(kind) ?? []), what]);
  await Promise.all(
    modulesOfBun.map(async first => {
      if (first === second) return;
      const command = [bunExe(), fixtureOfTwo, first, second];
      const { stdout, stderr, exitCode } = await inTurn(() => run(command, folder, environment, 60_000));
      const printed = stdout.split("\n").find(line => line.startsWith(mark));
      if (printed === undefined)
        throw new Error(`${second} behind ${first}: exit code ${exitCode}\n${stdout}\n${stderr}`);
      const { read, written }: { read: string[]; written: string[] } = JSON.parse(printed.slice(mark.length));
      for (const path of read) {
        const kind = kindOfRead(path);
        if (kind !== null) add(kind, path);
      }
      for (const path of written) add("global", path);
    }),
  );
  return found;
}

/** What the load of each of those modules showed in each place. */
async function sweepModules(): Promise<Map<string, Record<Place, Seen>>> {
  using folder = tempDir("aot-acts-at-load", {});
  const loads = specifiers.flatMap(specifier => places.map(place => [specifier, place] as const));
  const seen = await sweep(String(folder), loads);
  const inBoth = (index: number): Record<Place, Seen> => ({ main: seen[2 * index], worker: seen[2 * index + 1] });
  const ofModules = new Map(specifiers.map((specifier, index) => [specifier, inBoth(index)]));
  if (!asksWhatALoadReadsOfOtherModules) return ofModules;
  const kindOfRead = readsByTheTable();
  await Promise.all(
    Array.from(ofModules, async ([specifier, shown]) => {
      if (!mayLoadLate(specifier, shown)) return;
      // The second fixture runs in the main thread.
      for (const [kind, what] of await readsOfOtherModules(String(folder), specifier, kindOfRead)) {
        shown.main.set(kind, [...(shown.main.get(kind) ?? []), ...what]);
        if (isNamedRead(kind)) shown.worker.set(kind, [...(shown.worker.get(kind) ?? []), ...what]);
      }
    }),
  );
  return ofModules;
}

if (process.env.AOT_BUILTINS_UPDATE) {
  test("acts-at-load.txt takes what the load of each module does from the Bun under test", async () => {
    // Such a build would take out of the lines what it does not ask.
    if (process.platform === reference && !asksWhatALoadReadsOfOtherModules) return;
    const seen = await sweepModules();
    const made = (specifier: string) => lineOf(seen.get(specifier)!, list.lines.get(specifier), process.platform);
    const lines = new Map(specifiers.map(specifier => [specifier, made(specifier)]));
    const updatedText = formatList({ ...list, lines });
    if (updatedText !== text) writeFileSync(dataFile, updatedText);
  });
} else {
  test("the load of each module does what acts-at-load.txt says", async () => {
    const seen = await sweepModules();
    const differing = specifiers
      .filter(
        specifier =>
          !agrees(list.lines.get(specifier), seen.get(specifier)!, process.platform, asksWhatALoadReadsOfOtherModules),
      )
      .map(specifier => difference(specifier, list.lines.get(specifier), seen.get(specifier)!, process.platform));
    const ofNoModule = [...list.lines.keys()]
      .filter(specifier => !specifiers.includes(specifier))
      .map(specifier => `${specifier}: no program can import a module of that name that has source`);
    expect([...differing, ...ofNoModule]).toEqual([]);
  });
}

// One statement for each way that the fixture has of seeing a kind. Each is a file that the fixture imports, so each shows `cache` too.
const controls: [statement: string, shows: Kind | null, place?: Place][] = [
  ["module.exports = [Object.keys({}), [].push(1), new Map()];", null],
  ["module.exports = process.env.ACTS_AT_LOAD;", "env"],
  ["module.exports = Bun.env.ACTS_AT_LOAD;", "env"],
  ['module.exports = "ACTS_AT_LOAD" in process.env;', "env"],
  ['module.exports = Object.hasOwn(process.env, "ACTS_AT_LOAD");', "env"],
  ["module.exports = Object.keys(process.env);", "env"],
  ["module.exports = process.execArgv;", "env"],
  ["module.exports = process.argv;", "env"],
  ["module.exports = process.env.ACTS_AT_LOAD;", "env", "worker"],
  ['process.emitWarning("made by a control");', "warns"],
  ['console.log("made by a control");', "warns"],
  ['require("node:fs").writeSync(2, "made by a control");', "warns"],
  ['require("node:fs").writeSync(1, "made by a control");', "warns", "worker"],
  ['process.on("exit", () => {});', "listens"],
  ['addEventListener("error", () => {});', "listens"],
  ["setTimeout(() => {}, 100000);", "listens"],
  ["setInterval(() => {}, 100000).unref();", "listens"],
  ["setImmediate(() => {});", "listens"],
  ['new BroadcastChannel("acts-at-load").onmessage = () => {};', "listens"],
  ["globalThis.actsAtLoad = 1;", "global"],
  ["Array.prototype.actsAtLoad = 1;", "global"],
  ["globalThis.fetch = () => {};", "global"],
  ["delete Bun.FFI.callback;", "global"],
  ["MessagePort.prototype.close = function close() {};", "global"],
  ["process.actsAtLoad = 1;", "global", "worker"],
  ['require("node:diagnostics_channel").channel("acts-at-load");', "channel"],
  ['require("node:diagnostics_channel").tracingChannel("acts-at-load");', "channel"],
  ['throw new Error("made by a control");', "throws"],
  ["module.exports = Date.now;", "reads:Date.now"],
  ["module.exports = globalThis.setTimeout;", "reads:setTimeout"],
  ["module.exports = console.log;", "reads:console.log"],
  ["module.exports = process.emit;", "reads"],
  ["module.exports = class extends Error {};", "reads:Error"],
  ["module.exports = [Array.isArray, Object.keys, Symbol.for];", null],
  ["module.exports = process.nextTick;", "tick"],
  ["module.exports = process.nextTick;", "tick", "worker"],
  ['require("node:events");', "chain"],
  ['require("node:events");', "chain", "worker"],
];

test("the fixture sees each kind where a load shows it, and none where a load shows none", async () => {
  const sources = controls.map(([statement], index) => [`control-${index}.cjs`, `${statement}\n`]);
  using folder = tempDir("aot-acts-at-load", Object.fromEntries(sources));
  const fileOf = (index: number) => join(String(folder), sources[index][0]);
  const seen = await sweep(
    String(folder),
    controls.map(([, , place = "main"], index) => [fileOf(index), place] as const),
  );
  const missed = controls.flatMap(([statement, shows, place = "main"], index) => {
    const found = seen[index];
    // A file that throws leaves no entry.
    const isRight = shows === null ? found.size === 1 : found.has(shows);
    if (isRight && (shows === "throws" || found.has("cache"))) return [];
    return [`${statement} in ${namesOfPlaces[place]} shows ${shows ?? "nothing"}, and the fixture saw ${tell(found)}`];
  });
  expect(missed).toEqual([]);
});

test("every module that a program can import and that has source has a line", () => {
  expect(specifiers.length).toBeGreaterThan(70);
  expect(specifiers).toContain("node:fs");
  expect(specifiers).toContain("bun:sqlite");
  expect(specifiers).toContain("ws");
  // Native: src/jsc/modules makes it, and nothing under src/js.
  expect(specifiers).not.toContain("node:buffer");
  if (!process.env.AOT_BUILTINS_UPDATE) {
    const withoutALine = specifiers.filter(specifier => !list.lines.has(specifier));
    const ofNoModule = [...list.lines.keys()].filter(specifier => !specifiers.includes(specifier));
    expect({ withoutALine, ofNoModule }).toEqual({ withoutALine: [], ofNoModule: [] });
  }
  expect(list.head.length).toBeLessThanOrEqual(12);
});

test("formatList writes what parseList reads", () => {
  expect(formatList(list)).toBe(text);
  const small = "# what it is\na env warns tick # throws in a Worker only\nb\nc cache@win32 reads reads@darwin\n";
  expect(() => parseList(small)).toThrow(`${fileName}:4: a kind is plain or has marks, not both`);
  const marked = small.replace("reads reads@darwin", "reads@darwin reads@win32");
  expect(formatList(parseList(marked))).toBe(marked);
  expect(parseList(marked).lines.get("a")).toEqual({
    words: [{ kind: "env" }, { kind: "warns" }, { kind: "tick" }],
    comment: "throws in a Worker only",
  });
  expect(parseList(marked).lines.get("b")).toEqual({ words: [] });
  expect(parseList(marked).lines.get("c")?.words[0]).toEqual({ kind: "cache", platform: "win32" });
  expect(parseList("# only a head\n")).toEqual({ head: ["# only a head"], lines: new Map() });
});

test("parseList rejects malformed text", () => {
  for (const malformed of [
    "a env",
    "a  env\n",
    "a envs\n",
    "a tick env\n",
    "a env env\n",
    "a env@\n",
    `a env@${reference}\n`,
    "a env@win32@darwin\n",
    "a env@win32 env@darwin\n",
    "b\na\n",
    "a\na\n",
    "a\n# late\n",
  ]) {
    expect(() => parseList(malformed)).toThrow(fileName);
  }
});

test("a platform other than Linux is held to its marks and to no more than the line has", () => {
  const seenOf = (main: Kind[], worker: Kind[] = main): Record<Place, Seen> => ({
    main: new Map(main.map(kind => [kind, ["what"]])),
    worker: new Map(worker.map(kind => [kind, ["what"]])),
  });
  const listed = parseList("a env reads tick@win32\n").lines.get("a")!;
  const made = (seen: Record<Place, Seen>, platform: string) => textOfLine(lineOf(seen, listed, platform));

  // Linux: the plain kinds are what it shows, and the marks of the others stay.
  expect(agrees(listed, seenOf(["env", "reads"]), reference)).toBe(true);
  expect(agrees(listed, seenOf(["env"]), reference)).toBe(false);
  expect(agrees(listed, seenOf(["env", "reads", "tick"]), reference)).toBe(false);
  expect(made(seenOf(["env"]), reference)).toBe("env tick@win32");
  expect(made(seenOf(["env", "reads", "tick"]), reference)).toBe("env reads tick");
  expect(made(seenOf(["env", "reads"], ["env", "reads", "throws"]), reference)).toBe(
    "env throws reads tick@win32 # throws in a Worker only",
  );
  expect(difference("a", listed, seenOf(["env"], ["env", "chain"]), reference)).toBe(
    "a: listed env reads tick@win32, observed env tick@win32 chain # chain in a Worker only (in a Worker: chain: what)",
  );

  // Windows: its mark must show, a plain kind need not, and nothing else may.
  expect(agrees(listed, seenOf(["env", "reads", "tick"]), "win32")).toBe(true);
  expect(agrees(listed, seenOf(["tick"]), "win32")).toBe(true);
  expect(agrees(listed, seenOf(["env", "reads"]), "win32")).toBe(false);
  expect(agrees(listed, seenOf(["env", "reads", "tick", "chain"]), "win32")).toBe(false);
  expect(made(seenOf(["env", "chain"]), "win32")).toBe("env reads chain@win32");
  expect(difference("a", listed, seenOf(["env", "chain"]), "win32")).toBe(
    "a: listed env reads tick@win32, observed env chain on win32 (chain: what)",
  );

  // macOS: the mark of Windows says nothing of it.
  expect(agrees(listed, seenOf(["env", "reads"]), "darwin")).toBe(true);
  expect(agrees(listed, seenOf(["env", "reads", "tick"]), "darwin")).toBe(false);
  expect(made(seenOf(["env", "reads", "tick"]), "darwin")).toBe("env reads tick@darwin tick@win32");
});
