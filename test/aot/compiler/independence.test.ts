// A function's code does not hang on how large the program is: not on how many functions, names or layouts stand beside it.
// What is guessed of a value and tested at the run may come from any file of the program, and a proof is about the whole program: neither is asked about here.
//
// Feature 2 of the application of bench/compiler uses features 1 and 0, and the three use the shared router, the parser of command lines and the
// helpers for text: that is the small program. The large one has a hundred times as many features, and the same text in the files of these.
//
//   alone | inside            each function of the feature compiles to the same code
//   inside                    testaot same-bytes-alone: each of them among all the others, and again on a thread that has seen nothing else
//   alone | another caller    somebody else calls the shared helpers too, and no function of the features that call them changes
//   alone | padded            the main file holds ten thousand more functions, and no function of another file changes a byte
//   inside | padded           the same in the large program, where the sets of layouts are long
//   inside | other layouts    its main file makes a thousand records under names of their own, and no function of the feature changes an operation
//   a reader | beside names   a file that it never names mentions more names than the table of lookups has columns: the reader's names keep theirs
//   alone | another limit     the control: one constant of the feature is changed, and the comparison must report it
//   alone | another type      the control: somebody hands a shared helper what the features never do, and the comparison must report it
//   alone | another helper    the control: a shared helper is no longer copied in line, and the comparison must report the call
//
// A build writes its program with --aot-out, and `testaot bytes` prints what each unit of it compiles to: a hash of the code with the fields of its
// relocations cleared, and each relocation by the name of its symbol. The numbers behind the names are the image's, and differ by right.
// The numbers of shapes and orders are the plan's. They follow the whole program and lie in the code as immediates and as sets of bits,
// so two programs, each with a plan of its own, differ in them by right. Bytes alone judge where those numbers are the same: under one plan
// (same-bytes-alone), and beside padding that gives the plan nothing to number. Between any other two programs a unit with other bytes is held to its
// operations, which name layouts and not shapes, and to what its code calls: each call of a stub or of a function by its name, in their order, and how
// many returns, thunks, inline frames and handlers it has. In line or by a stub shows there, a number of a shape does not. One that agrees in both
// passes, and is counted.
// A record is one layout for each set of names, for the whole program, and a read off a value that nobody has typed goes by the name. So what other files
// store under a name that the unit reads is a fact about what the unit mentions, and differs by right: the part of a type that is marked
// ?ContentsOfEscapedObject, and which field of which record a fact about such a read names.
// A written type stands for every layout of the program that fits it, and the plan holds a slot to what the whole program stores there. Both are facts
// about what the unit mentions, and both grow with the features, by right. So between the small program and the large one, and there alone, a set of
// layouts is read as its first member and the type of a value is left out; the operation, its operands, the form of its result and its fields are compared.
// Every other pair mentions the same layouts, and is compared whole. What is rationed inside a long set shows beside the padding and the other layouts.
// The padding is there for what comes behind the walk: an emitter that reads a total of the program reads the same one in both halves of same-bytes-alone.
// A unit is known by its role and by the file, the position and the name of its function. What every caller has inlined is never compiled, so a
// unit that only one of two programs has is counted and not held against them.
//
// A difference names the function, the first lines of the two texts that differ, and the first operation that differs in what `testaot walk` prints.
import { afterAll, expect } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { generate } from "../../../bench/compiler/generate";
import { run } from "../engine/testaot";
import { without } from "../harness/capabilities";
import { slot } from "../harness/commands";
import { buildFlags, withProgramOutput, wordsOfAPlainBuild } from "../harness/flags";
import { describe, test } from "../supported";
import { build } from "./measure";

const extensions = { typed: "ts", erased: "js" } as const;
type Dress = keyof typeof extensions;

interface Unit {
  /** As its program numbers it: f12:Body. */
  name: string;
  lines: string[];
}
interface Program {
  title: string;
  file: string;
  units: Map<string, Unit>;
}
type Pair = [Program, Program];
type Judge = "operations" | "operations of a larger program" | "bytes";

const featuresAlone = 3;
const featuresInside = 100 * featuresAlone;
const paddingFunctions = 10_000;
const otherLayouts = 1_000;
const timeLimit = 900_000;

// The same types as the features hand over, so the facts about what they mention stay as they are. A template is a text whatever stands in it.
const callerThatHandsOver = (body: string) => `
import { flagOf } from "./flags";
import { text } from "./router";
import { hash, isInteger } from "./text";
router.get("/elsewhere/:place", request => text(418, ${body}));
const depth = flagOf(new Map([["depth", "4"]]), "depth", "9");
console.log(hash("a text that no feature has") + depth.length + Number(isInteger(depth)) + router.handle("/elsewhere/here").body.length);
`;
const anotherCaller = callerThatHandsOver("`${request.parameters.place}${request.path}`");
// What JSON.parse() gives may be anything. The slot of the body is no longer held to a text then, and whoever reads it has to ask.
// Not a sum with a text: that is proven to be a text.
const callerWithAnotherType = callerThatHandsOver("JSON.parse(JSON.stringify(request.path))");

// Each stands at the top of the module and captures nothing: no new layout, no environment. Each has the router make its record, with what the router
// puts there itself, stores into it, keeps it in a list that stays and reads it. So the plan numbers nothing new and holds the slots to what it held them
// to, and the program has ten thousand more callers of a shared helper, allocations, stores with a barrier, reads and tests. A literal of its own would
// give the record another home, and a variable that is written or a parameter that is read by name would have the layouts numbered in another order.
// So would `const kept = [..]`: a name that is stored once is expected to hold what the text of its file makes, and that word names the record.
// Each calls itself, so no caller inlines it and it is compiled.
// Not `padded += ..`: the type in front of a compound assignment is asked of the assignment in front of it, and TypeScript gives up 2,000 of those deep (TS2563).
function padding(dress: Dress) {
  const number = dress === "typed" ? ": number" : "";
  const functions = Array.from(
    { length: paddingFunctions },
    (_, index) => `function pad${index}(depth${number})${number} {
  const made = text(404, "not found");
  made.status = 404;
  kept[0] = made;
  return depth < 1 ? ${index} + made.body.length : pad${index}(depth - 1) + 1;
}
padded = padded + pad${index}(2);
`,
  );
  return `\nimport { text } from "./router";\nlet padded = 0;\nconst kept = Array.of(text(404, "not found"));\n${functions.join("")}console.log(padded + kept[0].status);\n`;
}

// Each record has a name that nothing else has, so no set of layouts that another file mentions gains a member, and the plan has a thousand more to number.
function recordsOfTheirOwn(dress: Dress) {
  const number = dress === "typed" ? ": number" : "";
  const functions = Array.from(
    { length: otherLayouts },
    (_, index) => `function own${index}(depth${number})${number} {
  const made = { own${index}: depth };
  return depth < 1 ? made.own${index} : own${index}(depth - 1) + 1;
}
owned = owned + own${index}(2);
`,
  );
  return `\nlet owned = 0;\n${functions.join("")}console.log(owned);\n`;
}

// `def` is typed by nobody and is read for `least` and `abort`. reader.js writes one record that lists `least` and may gain the rest. Which layout a guess
// takes for `def` may hang on what reader.js and the files that it imports write, and on nothing that a file writes which reader.js never names.
// `spare`: which answer of its site a read by name asks first hangs on whether the file of the reader writes a field under the name: here it does.
const reader = `
function least(value, params) { return { check: "least", ...JSON.parse(params), least: value }; }
function Check(def) { this.run = value => { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; if (value >= def.least) return "ok" + w; return def.abort ? "abort" : "small"; }; }
globalThis.Check = Check; globalThis.least = least; globalThis.spare = { abort: false };
`;
const readerInCompany =
  (company?: string, text = reader) =>
  () => ({
    "reader.js": text,
    ...(company && { "company.js": `globalThis.frame = ${company};\n` }),
    "main.js": `import "./reader.js";
${company ? 'import "./company.js";' : ""}
const n = JSON.parse("[3,5,1]"), Made = globalThis.Check, make = globalThis.least;
const a = new Made(make(n[0], "{}")), b = new Made(make(n[0], '{"abort":true}'));
console.log([a.run(n[1]), a.run(n[2]), b.run(n[1]), b.run(n[2])].join(" "));
`,
  });

// The table of lookups has a column for 65,534 names. The names that a program mentions are taken in the order of their numbers, which no program
// chooses, and those behind the last column are looked up by a hash. The two names that this reader reads stand late in that order.
const namesThatStandLate = ["a010060", "a010218"];
const readerOfNamesThatStandLate = reader
  .replace("least: value", `${namesThatStandLate[0]}: value`)
  .replace("def.least", `def.${namesThatStandLate[0]}`)
  .replace("def.abort", `def.${namesThatStandLate[1]}`)
  .replace("{ abort: false }", `{ ${namesThatStandLate[1]}: false }`);
const namesOfCompany = 70_000;
const readsInOneFunction = 1_000;
function companyThatMentionsMoreNamesThanThereAreColumns() {
  const names = Array.from({ length: namesOfCompany }, (_, index) => `a0${index}`).filter(
    name => !namesThatStandLate.includes(name),
  );
  const functions: string[] = [];
  for (let first = 0; first < names.length; first += readsInOneFunction) {
    const reads = names.slice(first, first + readsInOneFunction).map(name => `o.${name};`);
    functions.push(`o => { ${reads.join(" ")} }`);
  }
  return `[\n${functions.join(",\n")},\n]`;
}

function withChange(dress: Dress, name: string, change: (text: string) => string, features = featuresAlone) {
  const files = generate(features, dress);
  const path = `${name}.${extensions[dress]}`;
  files[path] = change(files[path]);
  return files;
}
const sources = {
  alone: (dress: Dress) => generate(featuresAlone, dress),
  inside: (dress: Dress) => generate(featuresInside, dress),
  "another caller": (dress: Dress) => withChange(dress, "main", text => text + anotherCaller),
  "a reader of names that stand late": readerInCompany(undefined, readerOfNamesThatStandLate),
  "a reader of names that stand late beside more names than there are columns": readerInCompany(
    companyThatMentionsMoreNamesThanThereAreColumns(),
    readerOfNamesThatStandLate,
  ),
  "another type": (dress: Dress) => withChange(dress, "main", text => text + callerWithAnotherType),
  // A loop keeps a function from being copied. The files of the features keep every position.
  "another helper": (dress: Dress) =>
    withChange(dress, "text", text =>
      text.replace("  return /^-?", "  for (let turn = 0; turn < 1; turn++);\n  return /^-?"),
    ),
  padded: (dress: Dress) => withChange(dress, "main", text => text + padding(dress)),
  "inside, padded": (dress: Dress) => withChange(dress, "main", text => text + padding(dress), featuresInside),
  "inside, other layouts": (dress: Dress) =>
    withChange(dress, "main", text => text + recordsOfTheirOwn(dress), featuresInside),
  // The number keeps its two digits, so every function keeps its position.
  "another limit": (dress: Dress) =>
    withChange(dress, "feature2", text => text.replace(/area < (\d+)/, (_, limit) => `area < ${Number(limit) + 1}`)),
};

// The file of a program holds no options.
const runOn = (command: string, file: string, ...units: string[]) =>
  slot(() => run(command, file, ...units, ...wordsOfAPlainBuild));

function unitsIn(lines: string[]) {
  const units = new Map<string, Unit>();
  let unit: Unit | undefined;
  for (const line of lines) {
    const [, name, role, written] = /^unit (f\d+:(\S+)) (.*)$/.exec(line) ?? [];
    if (!name) {
      unit?.lines.push(line);
      continue;
    }
    let key = `${role} ${written}`;
    for (let copy = 2; units.has(key); copy++) key = `${role} ${written} #${copy}`;
    units.set(key, (unit = { name, lines: [] }));
  }
  return units;
}

const folders: Disposable[] = [];
afterAll(() => folders.forEach(folder => folder[Symbol.dispose]()));

const whenCompiled = new Map<string, Promise<Program>>();
function compiled(dress: Dress, name: keyof typeof sources) {
  const title = `${name}, ${dress}`;
  const compile = async (): Promise<Program> => {
    const folder = tempDir("aot-independence", sources[name](dress));
    folders.push(folder);
    const file = join(String(folder), "program.aot");
    // Nothing here runs a program.
    await build(String(folder), [withProgramOutput(file), buildFlags.withoutExecutable]);
    const { lines, stderr, exitCode } = await runOn("bytes", file);
    expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    return { title, file, units: unitsIn(lines) };
  };
  if (!whenCompiled.has(title)) whenCompiled.set(title, compile());
  return whenCompiled.get(title)!;
}
const both = (dress: Dress, first: keyof typeof sources, second: keyof typeof sources): Promise<Pair> =>
  Promise.all([compiled(dress, first), compiled(dress, second)]);

const fileOf = (key: string) => /([^"\\/]*)":\d+ /.exec(key)?.[1] ?? "";
const linesOf = (program: Program, key: string) => program.units.get(key)!.lines;

function firstLinesThatDiffer([first, second]: string[][], read = (lines: string[]) => lines) {
  const [one, other] = [read(first), read(second)];
  for (let index = 0; index < Math.max(one.length, other.length); index++) {
    if (one[index] === other[index]) continue;
    return [first[index], second[index]].map(line => line?.trim() ?? "the text has ended");
  }
  return undefined;
}

// f12, L7, g3: what one program numbers its functions, layouts and variables. site(f12, v5)@5: an instance of a summary. callees=17: a row of a
// table of Facts or of the plan. Each becomes the place of its first mention, so two texts that differ in nothing else are equal.
// Values and blocks are numbered by the unit. A position, which has a blank in front of its @, is the file's.
const fieldsThatNameRows = "subject|callees|entrypoints";
const numbersOfTheProgram = new RegExp(
  String.raw`"(?:[^"\\]|\\.)*"|\b(?:[A-Za-z]|(?:${fieldsThatNameRows})=)\d+\b|(?<=[\w)])@\d+`,
  "g",
);
// undefined|number|string|Array?ContentsOfEscapedObject: the words in front of the mark. What else the type names is compared.
const contentsOfEscapedObjects = /(?:\w+\|)*\w+\?(?:\w+\+)*ContentsOfEscapedObject(?:\+\w+)*/g;
// v30: undefined|number|Array @JSValue: the type between the name of a value and the form it has.
const typesOfValues = /\b(v\d+): (?:(?! @[A-Z]).)* (@[A-Z]\w*)/g;
// L8|L29|L72 in a type, [L8, L29, L72] in a field.
const setsOfLayouts = /\b(L\d+)(?:\|L\d+)+|\[(L\d+)(?:, L\d+)+\]/g;
function withoutWhatDiffersByRight(line: string, judge: Judge) {
  const grown =
    judge === "operations of a larger program"
      ? line.replace(typesOfValues, "$1 $2").replace(setsOfLayouts, (_, inType, inField) => inType ?? `[${inField}]`)
      : line;
  const rest = grown.replace(contentsOfEscapedObjects, "?ContentsOfEscapedObject");
  return /^\s*fact \S+ kind=NarrowedTypes\b.*\bsubjectKind=Field\b/.test(rest) ? rest.replace(/ index=\d+/, "") : rest;
}
// What is left out is left out first: a layout that only one of two texts mentions there takes no place.
const byFirstMention = (judge: Judge) => (lines: string[]) => {
  const places = new Map<string, string>();
  return lines.map(line =>
    withoutWhatDiffersByRight(line, judge).replace(numbersOfTheProgram, token => {
      if (/^["bv]/.test(token)) return token;
      if (!places.has(token)) places.set(token, token.replace(/\d+$/, `#${places.size}`));
      return places.get(token)!;
    }),
  );
};

// relocation 497 Call Stub BinaryOperation.Add: without the place in the code, which follows the widths of the numbers in front of it.
function callsOf(lines: string[]) {
  const calls = lines.flatMap(line => /^\s*relocation \d+ (\S+ (?:Stub|Function) .*)$/.exec(line)?.[1] ?? []);
  const counts = lines.find(line => /^\s*size=/.test(line))?.match(/\b(?:returns|thunks|inlineFrames|handlers)=\d+/g);
  return [...calls, ...(counts ?? [])];
}

// Inline frames and constants stand in front of the first block. Most of what differs there follows from an operation further down, so the blocks are read first.
function blocksFirst(lines: string[]) {
  const start = Math.max(
    0,
    lines.findIndex(line => /^\s*b\d+\(/.test(line)),
  );
  return [...lines.slice(start), ...lines.slice(0, start)];
}

async function operationsOf(program: Program, keys: string[]) {
  const names = keys.map(key => program.units.get(key)!.name);
  const { lines, stderr, exitCode } = await runOn("walk", program.file, ...names);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const texts = new Map<string, string[]>();
  let text: string[] = [];
  for (const line of lines) {
    const name = /^code (f\d+:\S+)/.exec(line)?.[1];
    if (name) texts.set(name, (text = []));
    text.push(line);
  }
  return (key: string) =>
    texts.get(program.units.get(key)!.name) ?? [`testaot walk has printed nothing of it in ${program.title}`];
}

async function explained(programs: Pair, withOtherBytes: string[], judge: Judge) {
  if (!withOtherBytes.length) return [];
  const operations = await Promise.all(programs.map(program => operationsOf(program, withOtherBytes)));
  const labeled = (what: string, lines: string[]) =>
    lines.map((line, index) => `  ${what}, ${programs[index].title}: ${line}`);
  return withOtherBytes.flatMap(key => {
    const walk = firstLinesThatDiffer(
      operations.map(textOf => blocksFirst(textOf(key))),
      byFirstMention(judge),
    );
    const calls = firstLinesThatDiffer(programs.map(program => callsOf(linesOf(program, key))));
    if (!walk && !calls && judge !== "bytes") return [];
    const bytes = firstLinesThatDiffer(programs.map(program => linesOf(program, key))) ?? [];
    const operationsThatDiffer = walk ? labeled("walk", walk) : ["  walk: the same operations in both"];
    return [[key, ...labeled("bytes", bytes), ...labeled("calls", calls ?? []), ...operationsThatDiffer].join("\n")];
  });
}

async function compare(programs: Pair, files: string[], judge: Judge = "operations") {
  const [first, second] = programs.map(program => [...program.units.keys()].filter(key => files.includes(fileOf(key))));
  const shared = first.filter(key => programs[1].units.has(key));
  const withOtherBytes = shared.filter(
    key => linesOf(programs[0], key).join("\n") !== linesOf(programs[1], key).join("\n"),
  );
  const differences = await explained(programs, withOtherBytes, judge);
  console.error(
    `INDEPENDENCE ${programs[0].title} | ${programs[1].title}: ${first.length} | ${second.length} units of ${files.join(", ")}, ${shared.length} in both, ${differences.length} differ, ${withOtherBytes.length - differences.length} same operations, other bytes`,
  );
  return { shared, differences };
}

async function expectSameCode(programs: Pair, files: string[], judge?: Judge) {
  const { shared, differences } = await compare(programs, files, judge);
  expect(shared).not.toEqual([]);
  expect(differences).toEqual([]);
}

const declared = without("testaot") ? test.skip : test;

for (const dress of Object.keys(extensions) as Dress[]) {
  const fileNamed = (name: string) => `${name}.${extensions[dress]}`;
  const features = Array.from({ length: featuresAlone }, (_, index) => fileNamed(`feature${index}`));
  const feature = features.at(-1)!;
  const everyFileButMain = [...features, ...["flags", "router", "text"].map(fileNamed)];

  describe.concurrent(`a function compiles to the same code however large the program is: ${dress}`, () => {
    declared(
      "alone and inside a program a hundred times as large",
      async () => expectSameCode(await both(dress, "alone", "inside"), [feature], "operations of a larger program"),
      timeLimit,
    );

    declared(
      "among all the others and on a thread that has seen nothing else",
      async () => {
        const inside = await compiled(dress, "inside");
        const units = [...inside.units].flatMap(([key, unit]) => (fileOf(key) === feature ? [unit.name] : []));
        expect(units).not.toEqual([]);
        const { lines, stderr, exitCode } = await runOn("same-bytes-alone", inside.file, ...units);
        // A folded unit has no code of its own to compare. Nor has an entry of the method table under a name that no call goes through the table for:
        // the plan lists it from the calls as they are written, `testaot bytes` compiles what the plan lists, and a build compiles what some code mentions.
        const notTheSame = lines.filter(
          line => !/^f\d+:\S+ (same: |has the code of f\d+:\S+$|has no code in the whole program$)/.test(line),
        );
        expect({ notTheSame, stderr, exitCode }).toEqual({ notTheSame: [], stderr: expect.any(String), exitCode: 0 });
        expect(lines.some(line => / same: /.test(line))).toBe(true);
      },
      timeLimit,
    );

    declared(
      "another caller of the shared helpers changes no operation of the features that call them",
      async () => expectSameCode(await both(dress, "alone", "another caller"), features),
      timeLimit,
    );

    // HOW MANY names the whole program mentions decides which of them have a column (chooseKeysWithColumnForNamePlan): no access is compiled by it.
    (dress === "erased" ? declared : test.skip)(
      "a file that a reader never names mentions more names than there are columns, and the reader stays as it is",
      async () =>
        expectSameCode(
          await both(
            dress,
            "a reader of names that stand late",
            "a reader of names that stand late beside more names than there are columns",
          ),
          ["reader.js"],
        ),
      timeLimit,
    );

    declared(
      "padding that gives the plan nothing to number changes no byte",
      async () => {
        const programs = await both(dress, "alone", "padded");
        expect(programs[1].units.size - programs[0].units.size).toBeGreaterThanOrEqual(paddingFunctions);
        await expectSameCode(programs, everyFileButMain, "bytes");
      },
      timeLimit,
    );

    declared(
      "the same padding changes no byte where the sets of layouts are long",
      async () => expectSameCode(await both(dress, "inside", "inside, padded"), [feature], "bytes"),
      timeLimit,
    );

    declared(
      "a thousand layouts that fit nothing change no operation",
      async () => expectSameCode(await both(dress, "inside", "inside, other layouts"), [feature]),
      timeLimit,
    );

    declared(
      "the comparison reports a changed constant",
      async () =>
        expect((await compare(await both(dress, "alone", "another limit"), [feature])).differences).not.toEqual([]),
      timeLimit,
    );

    declared(
      "the comparison reports another type that a shared helper is handed",
      async () =>
        expect((await compare(await both(dress, "alone", "another type"), features)).differences).not.toEqual([]),
      timeLimit,
    );

    declared(
      "the comparison reports a helper that is no longer copied in line",
      async () =>
        expect((await compare(await both(dress, "alone", "another helper"), features)).differences.join("\n")).toMatch(
          /calls, another helper, \w+: Call Function Body .* "isInteger" /,
        ),
      timeLimit,
    );
  });
}
