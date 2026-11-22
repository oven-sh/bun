import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// Every small case of one kind, none drawn. first.mjs and second.mjs are mocked. The factory of first.mjs waits at a gate; meanwhile the factory of second.mjs asks for
// first.mjs. Whether it gets the original or waits for the mock hangs on who wrote what (src/jsc/bindings/BunPlugin.cpp: keyOfImportWhileModuleMocksRun()). A case is named
// by: whether first.mjs is a file of the project, one that had run before the mocks were laid, or a package . which of the two imports the test makes first, or whether it makes the second alone . where the first factory is written (the test, a helper, a function of the host) . where the second is . where the import() that asks is (the second factory, a file that
// had run, a file that the first factory loaded, a package; or the second factory requires it) . whether the two imports are made in one turn . who imports second.mjs . what the first factory does before it waits . whether
// first.mjs itself is asked for or a file that imports it by a statement, which may wait at an await . how the first factory ends, or that the second factory
// opens the gate itself behind its call, so that the first has settled when a call that is held comes to its turn.
// A case prints what the two imports give. A package gets the original with or without a wait: there the case also says whether the second import had settled before the gate was opened.
// Nothing hangs on a clock: gates are opened behind fresh files that a file of nobody's has loaded, one behind the other, and so is a wait given up that may never end.
// All cases are laid as one project: one plain run and one compiled run. What `bun test` prints is the specification.
const product = <Row extends readonly (readonly string[])[]>(...rows: Row): string[][] =>
  rows.reduce<string[][]>((found, row) => found.flatMap(head => row.map(next => [...head, next])), [[]]);

const files: Record<string, string> = {
  "package.json": `{ "name": "a-factory-asks-while-another-waits", "type": "module" }`,
};
let numberOfCases = 0;
for (const [mocked, order, first, second, asks, turn, begunBy, before, via, end] of product(
  ["file", "file that had run", "package"].map(kind => kind.replaceAll(" ", "_")),
  ["first-ahead", "second-ahead", "second-alone"],
  ["test", "helper", "host"],
  ["test", "helper"],
  ["factory", "asks", "dep", "package", "require"],
  ["one-turn", "later"],
  ["test", "begins", "root"],
  ["nothing", "imports-asks", "imports-dep", "requires-asks", "imports-over"],
  ["itself", "statement", "statement-that-waits"],
  ["resolves", "fails", "resolves-early"],
)) {
  if (asks === "dep" && (before !== "imports-dep" || turn === "one-turn")) continue;
  const isOfNarrowKind =
    end === "resolves-early" || mocked !== "file" || asks === "package" || asks === "require" || begunBy === "root";
  if (isOfNarrowKind && (before !== "nothing" || via !== "itself" || end === "fails" || first === "host")) continue;
  if (end === "resolves-early" && (mocked !== "file" || asks === "package" || asks === "require" || begunBy !== "test"))
    continue;
  if (mocked === "package" && (asks === "asks" || asks === "require" || begunBy !== "test")) continue;
  // Under `bun test` an import() written in a package, of a mocked module whose factory nobody has called yet, gets the module itself at once. Compiled code calls the factory and waits for it.
  if (asks === "package" && order !== "first-ahead" && (order === "second-alone" || turn === "later")) continue;
  if (end === "fails" && before === "imports-over") continue;
  // A load that waits for the mock below a statement is known by nothing but what others load meanwhile: fewer of those.
  if (
    via !== "itself" &&
    (end === "fails" || turn === "one-turn" || begunBy === "begins" || /imports-(asks|dep)/.test(before))
  )
    continue;
  if (order !== "first-ahead" && (asks === "dep" || before === "imports-over" || via !== "itself" || end === "fails"))
    continue;
  // Under `bun test` an import that the test makes while a factory written in the test runs gets the original, an instance of its own. Compiled code has one instance of a file.
  if (order !== "first-ahead" && first === "test" && (order === "second-alone" || turn === "later")) continue;
  numberOfCases++;
  const name = [mocked, order, first, second, asks, turn, begunBy, before, via, end].join("-");
  const [at, state] = [`c/${name}`, `globalThis["${name}"]`];
  const target = via === "itself" ? "first.mjs" : "over.mjs";
  const nameOfFirst = (dir: string) => (mocked === "package" ? `first-${numberOfCases}` : `${dir}/first.mjs`);
  for (const [ofPackage, text] of [
    [`first-${numberOfCases}`, `export const name = "real first";\n`],
    [`asks-${numberOfCases}`, `export const ask = () => import("${nameOfFirst(`../../${at}`)}");\n`],
  ]) {
    files[`node_modules/${ofPackage}/package.json`] =
      `{ "name": "${ofPackage}", "type": "module", "main": "index.js" }`;
    files[`node_modules/${ofPackage}/index.js`] = text;
  }
  files[`${at}/root.mjs`] = `export { name } from "./second.mjs";\n`;
  files[`${at}/first.mjs`] = `export const name = "real first";\n`;
  files[`${at}/second.mjs`] = `export const name = "real second";\n`;
  files[`${at}/over.mjs`] =
    via === "statement-that-waits"
      ? `import { name as seen } from "./first.mjs";\n${state}.overRuns();\nawait ${state}.tick;\nexport const name = "over saw " + seen;\n`
      : `export { name } from "./first.mjs";\n${state}.overRuns();\n`;
  files[`${at}/asks.mjs`] = `export const ask = () => import("./${target}");\n`;
  files[`${at}/asks.cjs`] = `exports.ask = () => import("./${target}");\n`;
  files[`${at}/dep.mjs`] = `${state}.ask = () => import("./${target}");\nexport const here = 1;\n`;
  files[`${at}/begins.mjs`] = `export const begin = () => import("./second.mjs");\n`;
  for (let fresh = 0; fresh < 12; fresh++) files[`${at}/fresh${fresh}.mjs`] = `export const fresh = ${fresh};\n`;
  files[`${at}/settles.mjs`] =
    `let next = 0;\nexport const settle = async () => { for (let count = 0; count < 4; count++) await import(\`./fresh\${next++}.mjs\`); };\n`;
  const firstFactory = (dir: string) => {
    const does = {
      "nothing": "",
      "imports-asks": `await import("${dir}/asks.mjs"); `,
      "imports-dep": `await import("${dir}/dep.mjs"); `,
      "requires-asks": `require("${dir}/asks.cjs"); `,
      "imports-over": `await import("${dir}/over.mjs"); `,
    }[before];
    return `async () => { ${does}await ${state}.gate; ${end !== "fails" ? `return { name: "first" };` : `throw new Error("the first factory fails");`} }`;
  };
  const secondFactory = (dir: string) => {
    const ask = {
      factory: via === "itself" ? `import("${nameOfFirst(dir)}")` : `import("${dir}/${target}")`,
      package: `ofPackage.ask()`,
      asks: before === "requires-asks" ? `asksByRequire.ask()` : `asks.ask()`,
      dep: `${state}.ask()`,
    }[asks];
    if (asks === "require")
      return `() => { ${state}.asked(); try { return { name: "second with " + require("${dir}/first.mjs").name }; } catch (error) { return { name: "second threw " + error.name }; } }`;
    return `async () => { const found = ${ask}.then(it => it.name, error => "threw " + error.message); ${end === "resolves-early" ? `${state}.open(); ` : ""}${state}.asked(); return { name: "second with " + (await found) }; }`;
  };
  const head = (dir: string) =>
    `import { createRequire } from "node:module";\nimport * as asks from "${dir}/asks.mjs";\nimport asksByRequire from "${dir}/asks.cjs";\nimport * as ofPackage from "asks-${numberOfCases}";\nconst require = createRequire(import.meta.url);\n`;
  files[`${at}/helper.mjs`] =
    `${head(".")}export const first = ${firstFactory(".")};\nexport const second = ${secondFactory(".")};\n`;
  const dir = `../${at}`;
  files[`t/${name}.test.js`] = `${head(dir)}import { test, vi } from "bun:test";
${mocked === "file_that_had_run" ? `import "${dir}/first.mjs";\nimport "${dir}/second.mjs";\n` : ""}import * as helper from "${dir}/helper.mjs";
import { begin } from "${dir}/begins.mjs";
import { settle } from "${dir}/settles.mjs";
const turns = async () => { for (let turn = 0; turn < 6; turn++) await new Promise(done => setImmediate(done)); };
const told = promise => promise.then(it => it.name, error => "threw " + error.message);
test("${name}", async () => {
  const state = (${state} = {});
  state.gate = new Promise(open => (state.open = open));
  state.tick = new Promise(pass => (state.passTick = pass));
  const asked = new Promise(done => (state.asked = done));
  const overRuns = new Promise(done => (state.overRuns = done));
  vi.doMock("${nameOfFirst(dir)}", ${{ test: firstFactory(dir), helper: "helper.first", host: `vi.fn(${firstFactory(dir)})` }[first]});
  vi.doMock("${dir}/second.mjs", ${{ test: secondFactory(dir), helper: "helper.second" }[second]});
  const importFirst = () => import("${nameOfFirst(dir)}");
  const importSecond = () => ${{ test: `import("${dir}/second.mjs")`, begins: `begin()`, root: `import("${dir}/root.mjs")` }[begunBy]};
  const ahead = ${order === "first-ahead" ? "importFirst" : "importSecond"}();
${turn === "later" ? `  await settle();\n  await turns();\n` : ""}${asks === "dep" ? `  while (!state.ask) await turns();\n` : ""}${before === "imports-over" ? `  await overRuns;\n` : ""}  const behind = ${{ "first-ahead": "importSecond()", "second-ahead": "importFirst()", "second-alone": "undefined" }[order]};
  const [first, second] = ${order === "first-ahead" ? "[ahead, behind]" : "[behind, ahead]"};
  await asked;
  await settle();
${via === "itself" ? "" : `  await Promise.race([overRuns, settle().then(turns)]);\n`}  await turns();
  state.passTick();
  await turns();
${asks === "package" ? `  const settled = await Promise.race([second.then(() => "ahead of the gate", () => "ahead of the gate"), settle().then(turns).then(() => "behind the gate")]);\n` : ""}  state.open();
  console.log("| ${name}:", await told(first ?? importFirst()), "|", await told(second)${asks === "package" ? ", settled" : ""});
});
`;
}

// Where a test file that mocked ends, `bun test` goes through the modules of every test file that its process has run (evictModulesAndTheirImporters() in BunPlugin.cpp): the more
// test files a process has run, the longer the next one takes. So each run deals its test files to workers. A worker keeps one realm for its files, as a run of one process does.
// The compiled run is still one build, of every test file.
const inWorkers = ["--parallel=8", "--no-isolate"];

async function said(dir: string, ...flags: string[]) {
  const isCompiled = flags.includes("--aot");
  // A thread that reads the texts may come behind what a case waits for: plain Bun then has two answers.
  const oneThread = isCompiled ? "0" : "1";
  const env = {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: oneThread,
    BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm",
  };
  // The workers hold nearly all the memory of a run: what they hold counts as the run's own, and is held to the limit of ./harness/memory-limit.ts.
  const withWorkers = true;
  const command = [bunExe(), "test", ...flags, ...inWorkers, "./t"];
  const { stdout, stderr, exitCode } = await run(command, dir, env, undefined, withWorkers);
  // What a run that failed says beside the answers, the passes and the names of the test files.
  const beside = stderr.split("\n").filter(line => !/^(\| |\(pass\) |t\/|$)/.test(line));
  if (exitCode !== 0) console.error(beside.slice(-200).join("\n"));
  const lines = [...(stdout + "\n" + stderr).matchAll(/^\| (\S+): (.*)$/gm)];
  const count = (found: RegExp) => Number(found.exec(stderr)?.[1]);
  return {
    answers: new Map(lines.map(([, name, answer]) => [name, answer])),
    ran: {
      lines: lines.length,
      pass: count(/^ *(\d+) pass$/m),
      fail: count(/^ *(\d+) fail$/m),
      exitCode,
      ...(isCompiled && { compiled: count(/^AOT test run \| one program \| test files (\d+)$/m) }),
    },
  };
}

const dir = tempDir("aot-mock-factories", files);
afterAll(() => dir[Symbol.dispose]());
// The limit is for a debug build on few processors: on three the case takes 261 s.
test("what each case prints", async () => {
  const [plain, compiled] = [await said(String(dir)), await said(String(dir), "--aot")];
  expect(plain.answers.size).toBe(numberOfCases);
  // The import of the test gives what the first factory ends with, whatever the second factory finds.
  const ofTheTest = (name: string) => (name.endsWith("-fails") ? "threw the first factory fails" : "first");
  expect([...plain.answers].filter(([name, answer]) => !answer.startsWith(`${ofTheTest(name)} | second `))).toEqual([]);
  const report = [...plain.answers]
    .filter(([name, expected]) => compiled.answers.get(name) !== expected)
    .map(([name, expected]) => `${name}: ${expected} > ${compiled.answers.get(name) ?? "nothing"}`);
  expect(report).toEqual([]);
  // How many cases give each answer. A number that changes is a change of what `bun test` does where two factories run at once.
  const howMany: Record<string, number> = {};
  for (const answer of plain.answers.values()) howMany[answer] = (howMany[answer] ?? 0) + 1;
  expect(howMany).toEqual({
    "first | second with first": 615,
    "first | second with real first": 243,
    "first | second with real first ahead of the gate": 84,
    "first | second with over saw first": 10,
    "first | second with over saw real first": 26,
    "first | second threw TypeError": 24,
    "threw the first factory fails | second with threw the first factory fails": 126,
    "threw the first factory fails | second with real first": 78,
  });
  // Every test file ran once and passed, the compiled ones as one program, and no run ended with an error of its own or by a signal.
  const whole = { lines: numberOfCases, pass: numberOfCases, fail: 0, exitCode: 0 };
  expect({ plain: plain.ran, compiled: compiled.ran }).toEqual({
    plain: whole,
    compiled: { ...whole, compiled: numberOfCases },
  });
}, 600_000);
