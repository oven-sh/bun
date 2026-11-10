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
// Nothing hangs on a clock but the bound on a wait that never ends: gates are opened behind fresh files that a file of nobody's has loaded, one behind the other.
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
const bound = (ms, value) => new Promise(done => setTimeout(done, ms, value));
const within = promise => Promise.race([promise.then(it => it.name, error => "threw " + error.message), bound(1500, "never settles")]);
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
${turn === "later" ? `  await settle();\n  await turns();\n` : ""}${asks === "dep" ? `  while (!state.ask) await turns();\n` : ""}${before === "imports-over" ? `  await Promise.race([overRuns, bound(1500)]);\n` : ""}  const behind = ${{ "first-ahead": "importSecond()", "second-ahead": "importFirst()", "second-alone": "undefined" }[order]};
  const [first, second] = ${order === "first-ahead" ? "[ahead, behind]" : "[behind, ahead]"};
  await Promise.race([asked, bound(1500)]);
  await settle();
${via === "itself" ? "" : `  await Promise.race([overRuns, bound(300)]);\n`}  await turns();
  state.passTick();
  await turns();
${asks === "package" ? `  const settled = await Promise.race([second.then(() => "ahead of the gate", () => "ahead of the gate"), bound(300, "behind the gate")]);\n` : ""}  state.open();
  console.log("| ${name}:", await within(first ?? importFirst()), "|", await within(second)${asks === "package" ? ", settled" : ""});
});
`;
}

async function said(dir: string, ...flagsAndFiles: string[]) {
  const { stdout, stderr } = await run([bunExe(), "test", ...flagsAndFiles], dir, { ...bunEnv, NO_COLOR: "1" });
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
  const [plain, compiled] = [await said(String(dir), "./t"), await said(String(dir), "--aot", "./t")];
  expect(plain.size).toBe(numberOfCases);
  const differing = () => [...plain].filter(([name, expected]) => compiled.get(name) !== expected);
  // Where the two runs part, `bun test` is asked again about those cases alone, as in harness/test-runs-in-folders.ts.
  for (let asked = 0; asked < 2 && differing().length > 0; asked++) {
    const again = await said(String(dir), ...differing().map(([name]) => `./t/${name}.test.js`));
    for (const [name, first] of differing()) {
      if (!compiled.has(name) || again.get(name) !== compiled.get(name)) continue;
      console.error(
        `THE REFERENCE WAVERED: ${name}: plain Bun said ${first} at first, and asked again what the compiled run said`,
      );
      plain.set(name, compiled.get(name)!);
    }
  }
  const told = differing().map(([name, expected]) => `${name}: ${expected} > ${compiled.get(name) ?? "nothing"}`);
  expect(told).toEqual([]);
}, 600_000);
