import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// The build warns of a computed path only where some code of the project isn't in the executable.
const leftOut = { "left-out.cjs": `module.exports = 1;\n` };
const path = `process.argv[2]`;

async function build(
  files: Record<string, string>,
  entryPoints = ["main.cjs"],
  flags: string[] = [],
  others: Record<string, string> = leftOut,
) {
  using dir = tempDir("bun-ignore-comments", { ...others, ...files });
  using out = tempDir("bun-ignore-comments-out", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", ...flags, ...entryPoints, "--outfile", join(String(out), "program")],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const said = stderr.match(
    /^(warn|note|error): (Silenced by bun-ignore: )?TS\d+(: This comment silences nothing: .*)?/gm,
  );
  return { said: said ?? [], exitCode };
}

const nothing = { said: [], exitCode: 0 };
const stale = (reason: string) => `warn: TS100073: This comment silences nothing: ${reason}`;

test("without a comment the build warns", async () => {
  expect(await build({ "main.cjs": `require(${path});\nBun.resolveSync(${path}, __dirname);\n` })).toEqual({
    said: ["warn: TS100064", "warn: TS100087"],
    exitCode: 0,
  });
});

test.each([
  ["on the line above", `// bun-ignore TS100064\nrequire(${path});\n`],
  ["at the end of the line", `require(${path}); // bun-ignore TS100064\n`],
  ["in a block comment", `/* bun-ignore TS100064 */\nrequire(${path});\n`],
  ["in front of the code", `/* bun-ignore TS100064 */ require(${path});\n`],
  ["with an explanation", `// bun-ignore TS100064 the plugins are passed as entry points\nrequire(${path});\n`],
  ["above another comment and an empty line", `// bun-ignore TS100064\n// Loads a plugin.\n\nrequire(${path});\n`],
  ["indented", `function load() {\n  // bun-ignore TS100064\n  return require(${path});\n}\nload();\n`],
])("a comment %s silences a warning of the engine", async (_, text) => {
  expect(await build({ "main.cjs": text })).toEqual(nothing);
});

test("a comment silences a warning of the front end", async () => {
  expect(await build({ "main.cjs": `Bun.resolveSync(${path}, __dirname); // bun-ignore TS100087\n` })).toEqual(nothing);
});

test.each([`TS100064, TS100087`, `TS100064 TS100087`, `TS100087,TS100064`])(
  "one comment names several codes: %s",
  async codes => {
    const text = `// bun-ignore ${codes}\nrequire(Bun.resolveSync(${path}, __dirname));\n`;
    expect(await build({ "main.cjs": text })).toEqual(nothing);
  },
);

test("a comment silences one line and the codes that it names", async () => {
  const text = `// bun-ignore TS100064\nrequire(${path});\nrequire(${path});\n// bun-ignore TS100064\nrequire(Bun.resolveSync(${path}, __dirname));\n`;
  expect(await build({ "main.cjs": text })).toEqual({ said: ["warn: TS100064", "warn: TS100087"], exitCode: 0 });
});

test("a comment at the end of a line doesn't reach the next line", async () => {
  const text = `console.log(1); // bun-ignore TS100064\nrequire(${path});\n`;
  expect(await build({ "main.cjs": text })).toEqual({
    said: [stale("the build reports no TS100064 on the line that it applies to"), "warn: TS100064"],
    exitCode: 0,
  });
});

test("a comment that silences nothing gets a warning for each code", async () => {
  const text = `// bun-ignore TS100064, TS100087\nrequire(${path});\n`;
  expect(await build({ "main.cjs": text })).toEqual({
    said: [stale("the build reports no TS100087 on the line that it applies to")],
    exitCode: 0,
  });
});

test.each([`// bun-ignore`, `// bun-ignore all`, `// bun-ignore the plugins are there`, `/* bun-ignore */`])(
  "there is no form that silences everything: %s",
  async comment => {
    expect(await build({ "main.cjs": `${comment}\nrequire(${path});\n` })).toEqual({
      said: [stale("it names no warning. Write the codes after it, as in // bun-ignore TS100064"), "warn: TS100064"],
      exitCode: 0,
    });
  },
);

test.each([`// bun-ignored TS100064`, `// ignore TS100064`, `// see bun-ignore TS100064`])(
  "another comment is only a comment: %s",
  async comment => {
    expect(await build({ "main.cjs": `${comment}\nrequire(${path});\n` })).toEqual({
      said: ["warn: TS100064"],
      exitCode: 0,
    });
  },
);

test("a type error is not silenced", async () => {
  const text = `// bun-ignore TS2322\nconst count: number = "one";\nconsole.log(count);\n`;
  const { said, exitCode } = await build({ "main.ts": text }, ["main.ts"]);
  expect(said).toContain("error: TS2322");
  expect(exitCode).not.toBe(0);
});

// A build that stops computes no warning of the engine, so it can't know that a comment is stale.
test.each([
  ["an engine's warning", `// bun-ignore TS100058\nnew RegExp(${path});\n`],
  ["a computed import", `// bun-ignore TS100064\nrequire(${path});\n`],
  ["a computed lookup", `// bun-ignore TS100087\nBun.resolveSync(${path}, __dirname);\n`],
])("a build that stops at a type error calls no comment stale: %s", async (_, text) => {
  expect(await build({ "main.cjs": text })).toEqual(nothing);
  const files = { "main.cjs": text, "wrong.ts": `export const count: number = "one";\n` };
  const { said, exitCode } = await build({ ...files, "main.ts": `import "./main.cjs";\nimport "./wrong.ts";\n` }, [
    "main.ts",
  ]);
  expect(said).toEqual(["error: TS2322"]);
  expect(exitCode).not.toBe(0);
});

test("a comment on the line of an error says that an error can't be silenced", async () => {
  const declared = `declare module "bun" { type int32 = number & { readonly "bun.int32"?: true }; }\n`;
  const text = `import type { int32 } from "bun";\n// bun-ignore TS100031\nconst made: int32 = Number(process.argv[2]);\nconsole.log(made);\n`;
  const { said, exitCode } = await build({ "main.ts": text, "bun.d.ts": declared }, ["main.ts"]);
  expect(said).toContain("error: TS100031");
  expect(said.filter(line => line.includes("TS100073"))).toEqual([
    stale("TS100031 is an error here, and a comment can't silence an error"),
  ]);
  expect(exitCode).not.toBe(0);
});

test("the code of a type error silences nothing", async () => {
  expect(await build({ "main.cjs": `// bun-ignore TS2322\nconsole.log(1);\n` })).toEqual({
    said: [stale("TS2322 isn't one of the compiler's own warnings, which are TS100000 to TS100999")],
    exitCode: 0,
  });
});

test("an error of the compiler is not silenced", async () => {
  const files = {
    "main.ts": `// bun-ignore TS100053\nimport { made } from "./macro.ts" with { type: "macro" };\nconsole.log(made());\n`,
    "macro.ts": `export const made = () => 1;\n`,
  };
  const { said, exitCode } = await build(files, ["main.ts"]);
  expect(said).toContain("error: TS100053");
  expect(exitCode).not.toBe(0);
});

test("the warning of a stale comment can't be silenced", async () => {
  const text = `// bun-ignore TS100073\n// bun-ignore TS100064\nconsole.log(1);\n`;
  const { said } = await build({ "main.cjs": text });
  expect(said).toContain(stale("the build reports no TS100064 on the line that it applies to"));
  expect(said).toContain(stale("TS100073 can't be silenced"));
});

test.each(["js", "ts", "jsx", "tsx", "mjs", "cjs"])("in a .%s file", async extension => {
  const entry = `main.${extension}`;
  const text = `// bun-ignore TS100087\nconsole.log(Bun.resolveSync(${path}, "."));\n`;
  expect(await build({ [entry]: text }, [entry])).toEqual(nothing);
  expect(await build({ [entry]: text.replace("TS100087", "TS100064") }, [entry])).toEqual({
    said: [stale("the build reports no TS100064 on the line that it applies to"), "warn: TS100087"],
    exitCode: 0,
  });
});

test("in a dependency a comment silences, and a stale one is not the user's to fix", async () => {
  const files = (text: string) => ({
    "main.cjs": `require("dep");\n`,
    "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js" }),
    "node_modules/dep/index.js": text,
  });
  expect((await build(files(`require(${path});\n`))).said).toEqual(["warn: TS100064"]);
  expect(await build(files(`// bun-ignore TS100064\nrequire(${path});\n`))).toEqual(nothing);
  expect(await build(files(`// bun-ignore TS100064\nconsole.log(1);\n// bun-ignore\n`))).toEqual(nothing);
});

// One file may belong to several programs. What one of them never runs, another may.
test.each([
  [
    "a function that this program doesn't call",
    `function load() {\n  // bun-ignore TS100064\n  return require(${path});\n}\n`,
  ],
  [
    "an arrow function that this program doesn't call",
    `const load = () => {\n  return require(${path}); // bun-ignore TS100064\n};\n`,
  ],
  ["a branch that is never taken", `if (false) {\n  // bun-ignore TS100064\n  require(${path});\n}\n`],
  [
    "a statement behind a return",
    `function load() {\n  return 1;\n  // bun-ignore TS100064\n  require(${path});\n}\nload();\n`,
  ],
  [
    "a lookup in a function that this program doesn't call",
    `function find() {\n  // bun-ignore TS100087\n  return Bun.resolveSync(${path}, __dirname);\n}\n`,
  ],
])("a comment in %s isn't stale", async (_, text) => {
  expect(await build({ "main.cjs": text + `console.log(1);\n` })).toEqual(nothing);
});

test("one shared file, one program that calls the function and one that doesn't", async () => {
  const files = {
    "shared.cjs": `exports.load = function (name) {\n  // bun-ignore TS100064\n  return require(name);\n};\nexports.other = () => 1;\n`,
    "calls.cjs": `require("./shared.cjs").load(${path});\n`,
    "calls-not.cjs": `require("./shared.cjs").other();\n`,
  };
  expect(await build(files, ["calls.cjs"])).toEqual(nothing);
  expect(await build(files, ["calls-not.cjs"])).toEqual(nothing);
});

test("an export that nobody imports", async () => {
  const files = {
    "main.mjs": `import { other } from "./shared.mjs";\nconsole.log(other());\n`,
    "shared.mjs": `export function load(name) {\n  // bun-ignore TS100064\n  return import(name);\n}\nexport const other = () => 1;\n`,
  };
  expect(await build(files, ["main.mjs"])).toEqual(nothing);
});

test("a comment isn't stale where the whole build has nothing to warn of", async () => {
  const text = `// bun-ignore TS100064\nrequire(${path});\n// bun-ignore TS100087\nBun.resolveSync(${path}, __dirname);\n`;
  expect(await build({ "main.cjs": text }, ["main.cjs", "./left-out.cjs"])).toEqual(nothing);
});

test("a comment in code that runs is still stale where nothing is to silence", async () => {
  const text = `function load() {\n  // bun-ignore TS100064\n  return 1;\n}\nload();\n`;
  expect(await build({ "main.cjs": text })).toEqual({
    said: [stale("the build reports no TS100064 on the line that it applies to")],
    exitCode: 0,
  });
});

test("among JSX children", async () => {
  const text = `const React = { createElement: (...all) => all };\nconst made = (\n  <div>\n    {/* bun-ignore TS100064 */}\n    {require(${path})}\n  </div>\n);\nconsole.log(made.length);\n`;
  const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react" } });
  expect(await build({ "main.jsx": text, "tsconfig.json": tsconfig }, ["main.jsx"])).toEqual(nothing);
});

test.each([
  ["CR LF", "\r\n"],
  ["CR", "\r"],
  ["U+2028", "\u2028"],
  ["U+2029", "\u2029"],
])("lines that end in %s", async (_, end) => {
  const above = [`console.log(1);`, `// bun-ignore TS100064`, `require(${path});`, ``].join(end);
  expect(await build({ "main.cjs": above })).toEqual(nothing);
  const behind = [`console.log(1);`, `require(${path}); // bun-ignore TS100064`, `require(${path});`, ``].join(end);
  expect(await build({ "main.cjs": behind })).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test.each([
  `TS100064.`,
  `TS100064: the plugins ship with the program`,
  `TS100064;TS100087`,
  `TS100064; TS100087.`,
  `TS100064 (see the README)`,
])("a mark behind a code: %s", async codes => {
  const call = codes.includes("TS100087") ? `require(Bun.resolveSync(${path}, __dirname))` : `require(${path})`;
  expect(await build({ "main.cjs": `// bun-ignore ${codes}\n${call};\n` })).toEqual(nothing);
});

test("letters behind a code make it no code", async () => {
  expect(await build({ "main.cjs": `// bun-ignore TS100064x\nrequire(${path});\n` })).toEqual({
    said: [stale("it names no warning. Write the codes after it, as in // bun-ignore TS100064"), "warn: TS100064"],
    exitCode: 0,
  });
});

test.each([
  ["on its first line", `/* bun-ignore TS100064\n   the plugins ship with the program */`],
  ["on its first line, with stars", `/**\n * bun-ignore TS100064 */`],
  ["on its first line, and more lines", `/* bun-ignore TS100064\n * the plugins\n * ship with the program\n */`],
  ["on its last line", `/* The plugins ship with the program.\n   bun-ignore TS100064 */`],
])("a comment of several lines with the words %s", async (_, comment) => {
  expect(await build({ "main.cjs": `${comment}\nrequire(${path});\n` })).toEqual(nothing);
});

test("--explain lists what a comment silenced", async () => {
  const text = `// bun-ignore TS100064\nrequire(${path});\n`;
  const { said, exitCode } = await build({ "main.cjs": text }, ["main.cjs"], ["--explain"]);
  expect(said).toEqual(["note: Silenced by bun-ignore: TS100064"]);
  expect(exitCode).toBe(0);
});

test("a build that computes no such warning calls no comment stale", async () => {
  const text = `// bun-ignore TS100064\nrequire(${path});\n`;
  expect(await build({ "main.cjs": text }, ["main.cjs"], ["--aot-allow-code-from-disk"])).toEqual(nothing);
});

test("the warning of a computed import stops once every file of the project is an entry point", async () => {
  const files = { "main.cjs": `require(${path});\n` };
  expect((await build(files)).said).toEqual(["warn: TS100064"]);
  expect(await build(files, ["main.cjs", "./left-out.cjs"])).toEqual(nothing);
  const more = { ...files, "second.cjs": `module.exports = 2;\n` };
  expect((await build(more, ["main.cjs", "./left-out.cjs"])).said).toEqual(["warn: TS100064"]);
});

test.each(["addon.node", "data.json", "notes.txt"])(
  "a second entry point that a computed import can't name as code doesn't stop the warning: %s",
  async name => {
    const files = { "main.cjs": `require(${path});\n`, [name]: name.endsWith(".json") ? "{}\n" : "no code\n" };
    expect(await build(files, ["main.cjs", `./${name}`], [], {})).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
  },
);

test("a dependency keeps the warning: the build doesn't look for what is left out of a package", async () => {
  const files = {
    "main.cjs": `require("dep");\nrequire(${path});\n`,
    "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js" }),
    "node_modules/dep/index.js": `require(${path});\n`,
    "node_modules/dep/plugin.js": `module.exports = 1;\n`,
  };
  expect((await build(files)).said).toEqual(["warn: TS100064", "warn: TS100064"]);
  expect(await build(files, ["main.cjs", "./left-out.cjs"])).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test("a program that is itself a package keeps the warning: what its user names lies outside", async () => {
  const files = {
    "node_modules/tool/package.json": JSON.stringify({ name: "tool", bin: "cli.cjs" }),
    "node_modules/tool/cli.cjs": `require("./extra.cjs");\nrequire(${path});\n`,
    "node_modules/tool/extra.cjs": `module.exports = 1;\n`,
  };
  const entryPoints = ["node_modules/tool/cli.cjs", "node_modules/tool/extra.cjs"];
  expect(await build(files, entryPoints, [], {})).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test("a project of one file keeps the warning of a computed import", async () => {
  using dir = tempDir("bun-ignore-comments-alone", { "main.cjs": `require(process.argv[2] ?? "some-package");\n` });
  using out = tempDir("bun-ignore-comments-out", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", join(String(out), "program")],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr.match(/^warn: TS\d+/gm)).toEqual(["warn: TS100064"]);
  expect(exitCode).toBe(0);
});
