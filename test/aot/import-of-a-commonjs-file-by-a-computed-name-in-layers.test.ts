import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

// `bun test --aot` compiles node_modules, src and the test files as programs of their own, and all of them run in one realm.
// `await import(path)` of a CommonJS file of src answered with the exports of a CommonJS package, or the other way round, whichever had been imported first.
// A CommonJS test file that imported itself got a file of src or a package.
// It takes a file in each program with the same number. A CommonJS file that is imported takes two, so an ES module in the middle of src lets odd and even numbers meet.
const count = 8;
const middle = count / 2 - 1;
const numbers = Array.from({ length: count }, (_, i) => i);
const user = (from: (i: number) => string, behindMiddle = "") => `${numbers
  .map(i => `import * as space${i} from "${from(i)}";${i === middle ? behindMiddle : ""}`)
  .join("\n")}
export const spaces = [${numbers.map(i => `space${i}`).join(", ")}];
export const load = name => import(name);
`;
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": "{}",
  "node_modules/pkg-user/package.json": `{ "name": "pkg-user", "type": "module", "main": "index.js" }`,
  "node_modules/pkg-user/index.js": user(i => `pkg-${i}`),
  "src/app.mjs": user(i => `./file-${i}.cjs`, `\nimport "./file-${middle}-then.mjs";`),
  [`src/file-${middle}-then.mjs`]: "export {};\n",
};
for (const i of numbers) {
  files[`node_modules/pkg-${i}/package.json`] = `{ "name": "pkg-${i}", "main": "index.js" }`;
  files[`node_modules/pkg-${i}/index.js`] = `exports.name = "pkg-${i}";\n`;
  files[`src/file-${i}.cjs`] = `exports.name = "file-${i}";\n`;
}

// Who asks for a file first decides what the loader holds when the others ask.
const askers = {
  "its own program": `[pkg.load, app.load]`,
  "the other program": `[app.load, pkg.load]`,
  "the test file": `[own, own]`,
};
const orders = {
  "packages first": {
    places: [0, 1],
    statements: `import * as pkg from "pkg-user";\nimport * as app from "./src/app.mjs";`,
    calls: "",
  },
  "src first": {
    places: [1, 0],
    statements: "",
    calls: `const app = await import("./src/app.mjs"), pkg = await import("pkg-user");`,
  },
};
for (const [first, { places, statements, calls }] of Object.entries(orders)) {
  for (const [who, loaders] of Object.entries(askers)) {
    files[`${first} by ${who}.test.js`.replaceAll(" ", "-")] = `import { test } from "bun:test";
${statements}
export const mine = ${JSON.stringify(`${first} by ${who}`)};
const own = name => import(name);
test(mine, async () => {
  ${calls}
  const [loadPackage, loadFile] = ${loaders};
  const steps = [];
  steps[${places[0]}] = async i => [await loadPackage(require.resolve("pkg-" + i)), pkg.spaces[i]];
  steps[${places[1]}] = async i => [await loadFile(import.meta.dir + "/src/file-" + i + ".cjs"), app.spaces[i]];
  const said = [];
  for (let i = 0; i < ${count}; i++) {
    for (const step of steps) {
      const [loaded, imported] = await step(i);
      said.push(loaded.name + (loaded === imported ? "" : " in another namespace object"));
    }
  }
  // Everybody asks again, once the loader has them all.
  for (let i = 0; i < ${count}; i++) {
    for (const load of [pkg.load, app.load, own])
      said.push((await load(require.resolve("pkg-" + i))).name, (await load(import.meta.dir + "/src/file-" + i + ".cjs")).name);
  }
  console.log("SAID", mine, said.join());
  console.log("SAID", mine, "imports itself", (await import(import.meta.path)).mine, (await import(import.meta.url)).mine);
});
`;
  }
}

// The runner imports a test file, so a CommonJS test file is such a file too, in the third program. Three ES test files sort between the two pairs.
const selfImporters = ["a-0", "a-1", "q-0", "q-1"];
for (const name of selfImporters) {
  files[`${name}-imports-itself.test.cjs`] = `const { test } = require("bun:test");
exports.mine = "${name}";
test("${name} imports itself", async () => {
  const pkg = await import("pkg-user"), app = await import("./src/app.mjs");
  for (let i = 0; i < ${count}; i++) {
    await pkg.load(require.resolve("pkg-" + i));
    await app.load(__dirname + "/src/file-" + i + ".cjs");
  }
  const self = await import(__filename);
  console.log("SAID ${name} imports itself", self.mine, self.default === module.exports);
});
`;
}

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return {
    said: stdout
      .split("\n")
      .filter(line => line.startsWith("SAID "))
      .sort(),
    exitCode,
  };
}

for (const [form, words] of [
  ["over two layers", "TestRunLayers:2"],
  ["as one program", "TestRunLayers:0"],
]) {
  test(`import() of a CommonJS file answers with that file, ${form}`, async () => {
    using dir = tempDir("aot-import-commonjs-by-name-in-layers", files);
    const plain = await runTests(String(dir), words);
    expect(plain.exitCode).toBe(0);
    expect(plain.said.length).toBe(16);
    const inTurn = (a: string, b: string) => numbers.flatMap(i => [a + i, b + i]);
    const again = numbers.flatMap(i => [`pkg-${i}`, `file-${i}`, `pkg-${i}`, `file-${i}`, `pkg-${i}`, `file-${i}`]);
    expect(plain.said).toContain(`SAID packages first by its own program ${[...inTurn("pkg-", "file-"), ...again]}`);
    expect(plain.said).toContain(`SAID src first by the test file ${[...inTurn("file-", "pkg-"), ...again]}`);
    for (const name of selfImporters) expect(plain.said).toContain(`SAID ${name} imports itself ${name} true`);
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 120_000);
}
