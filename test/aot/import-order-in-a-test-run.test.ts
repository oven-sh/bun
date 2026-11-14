// The order in which the files of several import() calls run, and the calls settle, in a test run.
//
// `bun test` reads sources on other threads and takes them in the order of the requests, with all jobs in between: one source a call, and, once the
// source of a file has arrived, one for each file that it imports and that nobody has requested for an importer. A call goes on once the sources
// of all files below its file have arrived. `expected()` is that queue. A compiled run answers so each time. Plain `bun test` answered so in eight of
// eight runs of each of 2,174 such cases, but depends on its threads, so it is not asked here.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Each file and what it imports. The letters of a case are the calls: `fl` is import("f"), import("l").
const imports: Record<string, string[]> = {
  f: ["w"], // w is called for as well
  i: ["v"],
  s: ["z"],
  t: ["z"],
  c: ["y"], // y imports x
  y: ["x"],
  d: ["p", "q"],
  e: ["f"],
  g: ["u"],
};
// They throw.
const failing = new Set(["g", "h"]);
const pairs = "fi fl lk st sl fs cf cl fw sz cy de df dl ef el dw gf gl gh hl hf".split(" ");
const triples = "fil fid flk stl ste cfl fwl fwi stz cyf efw ffl ffi fll ffw sst stt llk ssz".split(" ");

function permutations(letters: string): string[] {
  if (letters.length < 2) return [letters];
  const found = new Set<string>();
  for (let k = 0; k < letters.length; k++)
    for (const rest of permutations(letters.slice(0, k) + letters.slice(k + 1))) found.add(letters[k] + rest);
  return [...found];
}

type Case = { calls: string; jobs: number; requireAt?: number };
const cases: Case[] = [];
for (const letters of [...pairs.flatMap(pair => [pair, pair + pair]), ...triples])
  for (const calls of permutations(letters)) for (const jobs of [0, 1]) cases.push({ calls, jobs });
for (const calls of permutations("ffl"))
  for (const requireAt of [1, 2]) for (const jobs of [0, 1]) cases.push({ calls, jobs, requireAt });

function expected({ calls, requireAt }: Case) {
  type Call = { file: string; name: string; missing: number; seen: Set<string>; joins: boolean };
  const order: string[] = [];
  const ran = new Set<string>();
  const runFile = (file: string) => {
    for (const imported of imports[file] ?? []) runFile(imported);
    if (!ran.has(file)) order.push(file);
    ran.add(file);
  };
  const queue: (Call | string)[] = [];
  const counts: Record<string, number> = {};
  [...calls].forEach((file, index) => {
    if (index === requireAt) runFile("w");
    counts[file] = (counts[file] ?? 0) + 1;
    queue.push({ file, name: `${file}${counts[file]}`, missing: 0, seen: new Set(), joins: false });
  });
  const arrived = new Set<string>();
  const importers = new Map<string, Call[]>();
  const follow = (call: Call, file: string) => {
    for (const imported of imports[file] ?? []) {
      if (call.seen.has(imported)) continue;
      call.seen.add(imported);
      if (arrived.has(imported)) {
        follow(call, imported);
        continue;
      }
      if (!importers.has(imported)) {
        if (ran.has(imported)) continue;
        importers.set(imported, []);
        queue.push(imported);
      }
      importers.get(imported)!.push(call);
      call.missing++;
    }
  };
  for (let source; (source = queue.shift());) {
    let ready: Call[] = [];
    if (typeof source === "string") {
      arrived.add(source);
      const waiting = importers.get(source)!;
      importers.delete(source);
      for (const call of waiting) {
        call.missing--;
        follow(call, source);
        if (!call.missing) ready.push(call);
      }
      // The calls that began the loads of further files settle behind those that joined a load.
      const [first, ...others] = ready;
      ready = first ? [first, ...others.filter(call => call.joins), ...others.filter(call => !call.joins)] : [];
    } else {
      const { file } = source;
      const importersOfFile = importers.get(file);
      if (importersOfFile) {
        source.joins = true;
        source.seen.add(file);
        source.missing = 1;
        importersOfFile.push(source);
      } else {
        source.joins = arrived.has(file);
        if (!ran.has(file)) follow(source, file);
      }
      if (!source.missing) ready = [source];
      else if (!importersOfFile) arrived.add(file);
    }
    for (const call of ready) runFile(call.file);
    for (const call of ready) order.push(call.name);
  }
  return order.join(" ");
}

function project() {
  const files: Record<string, string> = { "package.json": `{ "type": "module" }` };
  const bodies = cases.map(({ calls, jobs, requireAt }, index) => {
    const add = (file: string) => {
      const below = imports[file] ?? [];
      const body = `ran("${file}");\n` + (failing.has(file) ? `throw new Error("thrown");\n` : "");
      files[`${file}${index}.mjs`] = below.map(name => `import "./${name}${index}.mjs";\n`).join("") + body;
      below.forEach(add);
    };
    const counts: Record<string, number> = {};
    const lines = [...calls].map((file, place) => {
      add(file);
      counts[file] = (counts[file] ?? 0) + 1;
      const load = place === requireAt ? `require("./w${index}.mjs"); ` : "";
      return `${load}calls.push(import("./${file}${index}.mjs").then(${failing.has(file) ? "undefined, " : ""}() => ran("${file}${counts[file]}")));`;
    });
    return `test("${index}", async () => { const calls = []; order = []; ${lines.join(jobs ? " await null; " : " ")} await Promise.all(calls); console.log("case ${index}: " + order.join(" ")); });`;
  });
  files["order.test.mjs"] =
    `import { test } from "bun:test";\nglobalThis.order = [];\nglobalThis.ran = name => { order.push(name); };\n` +
    bodies.join("\n");
  return files;
}

test("import() calls of a test run settle in the order of their sources", async () => {
  using dir = tempDir("aot-import-order", project());
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "./order.test.mjs"], String(dir), bunEnv);
  const said = [...(stdout + stderr).matchAll(/^case (\d+): (.*)$/gm)].map(line => `${line[1]} ${line[2]}`);
  const name = ({ calls, jobs, requireAt }: Case) =>
    calls + (jobs ? " a job apart" : "") + (requireAt ? ` require ${requireAt}` : "");
  expect({ said: said.map((line, k) => `${name(cases[k])}: ${line}`), exitCode }).toEqual({
    said: cases.map((each, index) => `${name(each)}: ${index} ${expected(each)}`),
    exitCode: 0,
  });
});

// The second call of the other file settles between them.
test("a failing call that nobody handles fails the test", async () => {
  using dir = tempDir("aot-import-order-unhandled", {
    "package.json": `{ "type": "module" }`,
    "fails.mjs": `import "./below.mjs";\nthrow new Error("thrown");\n`,
    "other.mjs": `import "./below.mjs";\n`,
    "below.mjs": `export const below = 1;\n`,
    "fails.test.mjs": `import { test } from "bun:test";
test("fails", async () => {
  import("./fails.mjs");
  const others = [import("./other.mjs"), import("./other.mjs")];
  await Promise.all(others);
  await new Promise(resolve => setTimeout(resolve, 20));
});
`,
  });
  for (const flags of [[], ["--aot"]]) {
    const { stderr, exitCode } = await run([bunExe(), "test", ...flags, "./fails.test.mjs"], String(dir), bunEnv);
    expect({ flags, said: stderr.includes("error: thrown"), exitCode }).toEqual({ flags, said: true, exitCode: 1 });
  }
});
