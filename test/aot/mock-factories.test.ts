import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// Every small case of one kind, none drawn. first.mjs and second.mjs are mocked. The factory of first.mjs waits at a gate; meanwhile the factory of second.mjs asks for
// first.mjs. Whether it gets the original or waits for the mock hangs on who wrote what (src/jsc/bindings/BunPlugin.cpp: keyOfImportWhileModuleMocksRun()). A case is named
// by: which of the two imports the test makes first, or whether it makes the second alone . where the first factory is written (the test, a helper, a function of the host) . where the second is . where the import() that asks is (the second factory, a file that
// had run, a file that the first factory loaded) . whether the two imports are made in one turn . who imports second.mjs . what the first factory does before it waits . whether
// first.mjs itself is asked for or a file that imports it by a statement, which may wait at an await . how the first factory ends.
// Nothing hangs on a clock but the bound on a wait that never ends: gates are opened behind fresh files that a file of nobody's has loaded, one behind the other.
// All cases are laid as one project: one plain run and one compiled run. What `bun test` prints is the specification.
const product = <Row extends readonly (readonly string[])[]>(...rows: Row): string[][] =>
  rows.reduce<string[][]>((found, row) => found.flatMap(head => row.map(next => [...head, next])), [[]]);

const files: Record<string, string> = {
  "package.json": `{ "name": "a-factory-asks-while-another-waits", "type": "module" }`,
};
let numberOfCases = 0;
for (const [order, first, second, asks, turn, begunBy, before, via, end] of product(
  ["first-ahead", "second-ahead", "second-alone"],
  ["test", "helper", "host"],
  ["test", "helper"],
  ["factory", "asks", "dep"],
  ["one-turn", "later"],
  ["test", "begins"],
  ["nothing", "imports-asks", "imports-dep", "requires-asks", "imports-over"],
  ["itself", "statement", "statement-that-waits"],
  ["resolves", "fails"],
)) {
  if (asks === "dep" && (before !== "imports-dep" || turn === "one-turn")) continue;
  if (end === "fails" && before === "imports-over") continue;
  // A load that waits for the mock below a statement is known by nothing but the time it takes: fewer of those.
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
  const name = [order, first, second, asks, turn, begunBy, before, via, end].join("-");
  const [at, state] = [`c/${name}`, `globalThis["${name}"]`];
  const target = via === "itself" ? "first.mjs" : "over.mjs";
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
  for (let fresh = 0; fresh < 8; fresh++) files[`${at}/fresh${fresh}.mjs`] = `export const fresh = ${fresh};\n`;
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
    return `async () => { ${does}await ${state}.gate; ${end === "resolves" ? `return { name: "first" };` : `throw new Error("the first factory fails");`} }`;
  };
  const secondFactory = (dir: string) => {
    const ask = {
      factory: `import("${dir}/${target}")`,
      asks: before === "requires-asks" ? `asksByRequire.ask()` : `asks.ask()`,
      dep: `${state}.ask()`,
    }[asks];
    return `async () => { const found = ${ask}.then(it => it.name, error => "threw " + error.message); ${state}.asked(); return { name: "second with " + (await found) }; }`;
  };
  const head = (dir: string) =>
    `import { createRequire } from "node:module";\nimport * as asks from "${dir}/asks.mjs";\nimport asksByRequire from "${dir}/asks.cjs";\nconst require = createRequire(import.meta.url);\n`;
  files[`${at}/helper.mjs`] =
    `${head(".")}export const first = ${firstFactory(".")};\nexport const second = ${secondFactory(".")};\n`;
  const dir = `../${at}`;
  files[`t/${name}.test.js`] = `${head(dir)}import { test, vi } from "bun:test";
import * as helper from "${dir}/helper.mjs";
import { begin } from "${dir}/begins.mjs";
import { settle } from "${dir}/settles.mjs";
const turns = async () => { for (let turn = 0; turn < 6; turn++) await new Promise(done => setImmediate(done)); };
const bound = (ms, value) => new Promise(done => setTimeout(done, ms, value));
const within = promise => Promise.race([promise.then(it => it.name, error => "threw " + error.message), bound(1500, "never settles")]);
test("${name}", async () => {
  const state = (${state} = {});
  state.gate = new Promise(open => (state.open = open));
  state.tick = new Promise(pass => (state.passTick = pass));
  const asked = new Promise(done => (state.asked = done));
  const overRuns = new Promise(done => (state.overRuns = done));
  vi.doMock("${dir}/first.mjs", ${{ test: firstFactory(dir), helper: "helper.first", host: `vi.fn(${firstFactory(dir)})` }[first]});
  vi.doMock("${dir}/second.mjs", ${{ test: secondFactory(dir), helper: "helper.second" }[second]});
  const importFirst = () => import("${dir}/first.mjs");
  const importSecond = () => ${begunBy === "test" ? `import("${dir}/second.mjs")` : `begin()`};
  const ahead = ${order === "first-ahead" ? "importFirst" : "importSecond"}();
${turn === "later" ? `  await settle();\n  await turns();\n` : ""}${asks === "dep" ? `  while (!state.ask) await turns();\n` : ""}${before === "imports-over" ? `  await Promise.race([overRuns, bound(1500)]);\n` : ""}  const behind = ${{ "first-ahead": "importSecond()", "second-ahead": "importFirst()", "second-alone": "undefined" }[order]};
  const [first, second] = ${order === "first-ahead" ? "[ahead, behind]" : "[behind, ahead]"};
  await Promise.race([asked, bound(1500)]);
  await settle();
${via === "itself" ? "" : `  await Promise.race([overRuns, bound(300)]);\n`}  await turns();
  state.passTick();
  await turns();
  state.open();
  console.log("| ${name}:", await within(first ?? importFirst()), "|", await within(second));
});
`;
}

async function said(dir: string, ...flags: string[]) {
  const { stdout, stderr } = await run([bunExe(), "test", ...flags, "./t"], dir, { ...bunEnv, NO_COLOR: "1" });
  const lines = new Map<string, string>();
  for (const line of (stdout + "\n" + stderr).split("\n")) {
    const found = line.match(/^\| (\S+): (.*)$/);
    if (found) lines.set(found[1], found[2]);
  }
  return lines;
}

const dir = tempDir("aot-mock-factories", files);
afterAll(() => dir[Symbol.dispose]());
test("what each case prints", async () => {
  const [plain, compiled] = [await said(String(dir)), await said(String(dir), "--aot")];
  expect(plain.size).toBe(numberOfCases);
  const differing = [...plain]
    .filter(([name, expected]) => compiled.get(name) !== expected)
    .map(([name, expected]) => `${name}: ${expected} > ${compiled.get(name) ?? "nothing"}`);
  expect(differing).toEqual([]);
}, 600_000);
