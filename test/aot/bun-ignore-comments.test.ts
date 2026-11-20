import { expect } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename, join } from "node:path";
import { buildFlags } from "./harness/flags";
import { test as oneAtATime } from "./supported";

// Every case only waits for builds, and every build has folders of its own.
const test = oneAtATime.concurrent;

const leftOut = { "left-out.cjs": `module.exports = 1;\n` };
const path = `process.argv[2]`;

/** The messages of a build that carry a code, each with the name of the file that it points at, and the exit code. */
async function messagesOf(
  files: Record<string, string>,
  entryPoints = ["main.cjs"],
  flags: string[] = [],
  others: Record<string, string> = leftOut,
  links: Record<string, string> = {},
  root = ".",
) {
  using dir = tempDir("bun-ignore-comments", { ...others, ...files });
  for (const [at, to] of Object.entries(links))
    symlinkSync(to, join(String(dir), at), at.endsWith(".cjs") ? "file" : "dir");
  using out = tempDir("bun-ignore-comments-out", {});
  // No case starts its program, so no build writes one. The compile, which makes the messages, is over before that.
  const compile = [bunExe(), "build", "--compile", "--aot", buildFlags.withoutExecutable];
  await using proc = Bun.spawn({
    cmd: [...compile, ...flags, ...entryPoints, "--outfile", join(String(out), "program")],
    cwd: join(String(dir), root),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const messages = Array.from(
    stderr.matchAll(
      /^((?:warn|note|error): (?:Silenced by bun-ignore: )?TS\d+(?:: This comment silences nothing: .*)?).*(?:\n +at (.*):\d+:\d+$)?/gm,
    ),
    ([, text, place = ""]) => ({ text, at: basename(place) }),
  );
  // A build that fails and names no error of its own has died. Only its stderr says of what.
  if (exitCode !== 0 && !messages.some(({ text }) => text.startsWith("error: "))) console.error(stderr);
  return { messages, exitCode };
}

async function build(...project: Parameters<typeof messagesOf>) {
  const { messages, exitCode } = await messagesOf(...project);
  return { said: messages.map(({ text }) => text), exitCode };
}

// Most cases ask how the comments of one file are read, where the file itself runs the code that they stand at. Of such
// a file a build says the same whatever else the program holds, and every message names its file. So these cases are
// the files of one program, which is built once. A case has a build of its own where it asks what a program calls, how
// a build ends, or what a flag or a folder changes.
const together: Record<string, string> = {};
let builtTogether: ReturnType<typeof messagesOf> | undefined;

/** Adds a file of this text to that program, and answers its name for `saidOf`. */
function file(text: string, extension = "cjs") {
  if (builtTogether) throw new Error("the program is built already");
  const name = `file-${Object.keys(together).length}.${extension}`;
  together[name] = text;
  return name;
}

function buildTogether() {
  const main = Object.keys(together).map(name => `import "./${name}";\n`);
  return (builtTogether ??= messagesOf({ ...together, "main.mjs": main.join("") }, ["main.mjs"]));
}

/** What the build of that program said of one of its files: what `build` answers for a program of the file alone. */
async function saidOf(name: string) {
  const { messages, exitCode } = await buildTogether();
  return { said: messages.filter(({ at }) => at === name).map(({ text }) => text), exitCode };
}

const nothing = { said: [], exitCode: 0 };
const stale = (reason: string) => `warn: TS100073: This comment silences nothing: ${reason}`;

test("every message of the build that the cases share names the file of a case", async () => {
  const { messages, exitCode } = await buildTogether();
  expect({ others: messages.filter(({ at }) => !(at in together)), exitCode }).toEqual({ others: [], exitCode: 0 });
});

const withoutComment = file(`require(${path});\nBun.resolveSync("./left-out.cjs", __dirname);\n`);
test("without a comment the build warns", async () => {
  expect(await saidOf(withoutComment)).toEqual({ said: ["warn: TS100064", "warn: TS100099"], exitCode: 0 });
});

test.each([
  ["on the line above", file(`// bun-ignore TS100064\nrequire(${path});\n`)],
  ["at the end of the line", file(`require(${path}); // bun-ignore TS100064\n`)],
  ["in a block comment", file(`/* bun-ignore TS100064 */\nrequire(${path});\n`)],
  ["in front of the code", file(`/* bun-ignore TS100064 */ require(${path});\n`)],
  ["with an explanation", file(`// bun-ignore TS100064 the plugins are passed as entry points\nrequire(${path});\n`)],
  [
    "above another comment and an empty line",
    file(`// bun-ignore TS100064\n// Loads a plugin.\n\nrequire(${path});\n`),
  ],
  ["indented", file(`function load() {\n  // bun-ignore TS100064\n  return require(${path});\n}\nload();\n`)],
])("a comment %s silences a warning of the engine", async (_, name) => {
  expect(await saidOf(name)).toEqual(nothing);
});

const frontEnd = file(`Bun.resolveSync("./left-out.cjs", __dirname); // bun-ignore TS100099\n`);
test("a comment silences a warning of the front end", async () => {
  expect(await saidOf(frontEnd)).toEqual(nothing);
});

test.each(
  [`TS100064, TS100099`, `TS100064 TS100099`, `TS100099,TS100064`].map(codes => [
    codes,
    file(`// bun-ignore ${codes}\nrequire(Bun.resolveSync("./left-out.cjs", __dirname));\n`),
  ]),
)("one comment names several codes: %s", async (_, name) => {
  expect(await saidOf(name)).toEqual(nothing);
});

const severalLines = file(
  `// bun-ignore TS100064\nrequire(${path});\nrequire(${path});\n// bun-ignore TS100064\nrequire(Bun.resolveSync("./left-out.cjs", __dirname));\n`,
);
test("a comment silences one line and the codes that it names", async () => {
  expect(await saidOf(severalLines)).toEqual({ said: ["warn: TS100064", "warn: TS100099"], exitCode: 0 });
});

const behindOtherCode = file(`console.log(1); // bun-ignore TS100064\nrequire(${path});\n`);
test("a comment at the end of a line doesn't reach the next line", async () => {
  expect(await saidOf(behindOtherCode)).toEqual({
    said: [stale("the build reports no TS100064 on the line that it applies to"), "warn: TS100064"],
    exitCode: 0,
  });
});

const oneCodeTooMany = file(`// bun-ignore TS100064, TS100099\nrequire(${path});\n`);
test("a comment that silences nothing gets a warning for each code", async () => {
  expect(await saidOf(oneCodeTooMany)).toEqual({
    said: [stale("the build reports no TS100099 on the line that it applies to")],
    exitCode: 0,
  });
});

test.each(
  [`// bun-ignore`, `// bun-ignore all`, `// bun-ignore the plugins are there`, `/* bun-ignore */`].map(comment => [
    comment,
    file(`${comment}\nrequire(${path});\n`),
  ]),
)("there is no form that silences everything: %s", async (_, name) => {
  expect(await saidOf(name)).toEqual({
    said: [stale("it names no warning. Write the codes after it, as in // bun-ignore TS100064"), "warn: TS100064"],
    exitCode: 0,
  });
});

test.each(
  [`// bun-ignored TS100064`, `// ignore TS100064`, `// see bun-ignore TS100064`].map(comment => [
    comment,
    file(`${comment}\nrequire(${path});\n`),
  ]),
)("another comment is only a comment: %s", async (_, name) => {
  expect(await saidOf(name)).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test("a type error is not silenced", async () => {
  const text = `// bun-ignore TS2322\nconst count: number = "one";\nconsole.log(count);\n`;
  expect(await build({ "main.ts": text }, ["main.ts"])).toEqual({
    said: [stale("TS2322 isn't one of the compiler's own warnings, which are TS100000 to TS100999"), "error: TS2322"],
    exitCode: 1,
  });
});

// A build that stops computes no warning of the engine, so it can't know that a comment is stale.
test.each(
  [
    ["an engine's warning", `// bun-ignore TS100058\nnew RegExp(${path});\n`],
    ["a computed import", `// bun-ignore TS100064\nrequire(${path});\n`],
    ["a written lookup", `// bun-ignore TS100099\nBun.resolveSync("./left-out.cjs", __dirname);\n`],
  ].map(([warning, text]) => [warning, text, file(text)]),
)("a build that stops at a type error calls no comment stale: %s", async (_, text, name) => {
  expect(await saidOf(name)).toEqual(nothing);
  const files = { "main.cjs": text, "wrong.ts": `export const count: number = "one";\n` };
  expect(await build({ ...files, "main.ts": `import "./main.cjs";\nimport "./wrong.ts";\n` }, ["main.ts"])).toEqual({
    said: ["error: TS2322"],
    exitCode: 1,
  });
});

test("a comment on the line of an error says that an error can't be silenced", async () => {
  const declared = `declare module "bun" { type int32 = number & { readonly "bun.int32"?: true }; }\n`;
  const text = `import type { int32 } from "bun";\n// bun-ignore TS100031\nconst made: int32 = Number(process.argv[2]);\nconsole.log(made);\n`;
  expect(await build({ "main.ts": text, "bun.d.ts": declared }, ["main.ts"])).toEqual({
    said: [stale("TS100031 is an error here, and a comment can't silence an error"), "error: TS100031"],
    exitCode: 1,
  });
});

const codeOfTypeError = file(`// bun-ignore TS2322\nconsole.log(1);\n`);
test("the code of a type error silences nothing", async () => {
  expect(await saidOf(codeOfTypeError)).toEqual({
    said: [stale("TS2322 isn't one of the compiler's own warnings, which are TS100000 to TS100999")],
    exitCode: 0,
  });
});

test("an error of the compiler is not silenced", async () => {
  const files = {
    "main.ts": `// bun-ignore TS100053\nimport { made } from "./macro.ts" with { type: "macro" };\nconsole.log(made());\n`,
    "macro.ts": `export const made = () => 1;\n`,
  };
  expect(await build(files, ["main.ts"])).toEqual({ said: ["error: TS100053"], exitCode: 1 });
});

const staleOfStale = file(`// bun-ignore TS100073\n// bun-ignore TS100064\nconsole.log(1);\n`);
test("the warning of a stale comment can't be silenced", async () => {
  expect(await saidOf(staleOfStale)).toEqual({
    said: [stale("TS100073 can't be silenced"), stale("the build reports no TS100064 on the line that it applies to")],
    exitCode: 0,
  });
});

const computedImport = `// bun-ignore TS100064\nimport(${path}).catch(() => {});\n`;
test.each(
  ["js", "ts", "jsx", "tsx", "mjs", "cjs"].map(extension => [
    extension,
    file(computedImport, extension),
    file(computedImport.replace("TS100064", "TS100058"), extension),
  ]),
)("in a .%s file", async (_, silenced, other) => {
  expect(await saidOf(silenced)).toEqual(nothing);
  expect(await saidOf(other)).toEqual({
    said: [stale("the build reports no TS100058 on the line that it applies to"), "warn: TS100064"],
    exitCode: 0,
  });
});

test("in a dependency a comment silences, and a stale one is not the user's to fix", async () => {
  const files = (text: string) => ({
    "main.cjs": `require("dep");\n`,
    "node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js" }),
    "node_modules/dep/index.js": text,
  });
  const [unsilenced, silenced, staleComments] = await Promise.all([
    build(files(`require(${path});\n`)),
    build(files(`// bun-ignore TS100064\nrequire(${path});\n`)),
    build(files(`// bun-ignore TS100064\nconsole.log(1);\n// bun-ignore\n`)),
  ]);
  expect(unsilenced).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
  expect(silenced).toEqual(nothing);
  expect(staleComments).toEqual(nothing);
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
    `function find() {\n  // bun-ignore TS100099\n  return Bun.resolveSync("./left-out.cjs", __dirname);\n}\n`,
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
  const [calls, callsNot] = await Promise.all([build(files, ["calls.cjs"]), build(files, ["calls-not.cjs"])]);
  expect(calls).toEqual(nothing);
  expect(callsNot).toEqual(nothing);
});

test("an export that nobody imports", async () => {
  const files = {
    "main.mjs": `import { other } from "./shared.mjs";\nconsole.log(other());\n`,
    "shared.mjs": `export function load(name) {\n  // bun-ignore TS100064\n  return import(name);\n}\nexport const other = () => 1;\n`,
  };
  expect(await build(files, ["main.mjs"])).toEqual(nothing);
});

test("a comment in a build where every file is an entry point", async () => {
  const text = `// bun-ignore TS100064\nrequire(${path});\n`;
  expect(await build({ "main.cjs": text }, ["main.cjs", "./left-out.cjs"])).toEqual(nothing);
});

const runs = file(`function load() {\n  // bun-ignore TS100064\n  return 1;\n}\nload();\n`);
test("a comment in code that runs is still stale where nothing is to silence", async () => {
  expect(await saidOf(runs)).toEqual({
    said: [stale("the build reports no TS100064 on the line that it applies to")],
    exitCode: 0,
  });
});

test("among JSX children", async () => {
  const text = `const React = { createElement: (...all) => all };\nconst made = (\n  <div>\n    {/* bun-ignore TS100064 */}\n    {require(${path})}\n  </div>\n);\nconsole.log(made.length);\n`;
  const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react" } });
  expect(await build({ "main.jsx": text, "tsconfig.json": tsconfig }, ["main.jsx"])).toEqual(nothing);
});

test.each(
  [
    ["CR LF", "\r\n"],
    ["CR", "\r"],
    ["U+2028", "\u2028"],
    ["U+2029", "\u2029"],
  ].map(([name, end]) => [
    name,
    file([`console.log(1);`, `// bun-ignore TS100064`, `require(${path});`, ``].join(end)),
    file([`console.log(1);`, `require(${path}); // bun-ignore TS100064`, `require(${path});`, ``].join(end)),
  ]),
)("lines that end in %s", async (_, above, behind) => {
  expect(await saidOf(above)).toEqual(nothing);
  expect(await saidOf(behind)).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test.each(
  [
    `TS100064.`,
    `TS100064: the plugins ship with the program`,
    `TS100064;TS100099`,
    `TS100064; TS100099.`,
    `TS100064 (see the README)`,
  ].map(codes => {
    const call = codes.includes("TS100099")
      ? `require(Bun.resolveSync("./left-out.cjs", __dirname))`
      : `require(${path})`;
    return [codes, file(`// bun-ignore ${codes}\n${call};\n`)];
  }),
)("a mark behind a code: %s", async (_, name) => {
  expect(await saidOf(name)).toEqual(nothing);
});

const lettersBehind = file(`// bun-ignore TS100064x\nrequire(${path});\n`);
test("letters behind a code make it no code", async () => {
  expect(await saidOf(lettersBehind)).toEqual({
    said: [stale("it names no warning. Write the codes after it, as in // bun-ignore TS100064"), "warn: TS100064"],
    exitCode: 0,
  });
});

test.each(
  [
    ["on its first line", `/* bun-ignore TS100064\n   the plugins ship with the program */`],
    ["on its first line, with stars", `/**\n * bun-ignore TS100064 */`],
    ["on its first line, and more lines", `/* bun-ignore TS100064\n * the plugins\n * ship with the program\n */`],
    ["on its last line", `/* The plugins ship with the program.\n   bun-ignore TS100064 */`],
  ].map(([where, comment]) => [where, file(`${comment}\nrequire(${path});\n`)]),
)("a comment of several lines with the words %s", async (_, name) => {
  expect(await saidOf(name)).toEqual(nothing);
});

test("--explain lists what a comment silenced", async () => {
  const text = `// bun-ignore TS100064\nrequire(${path});\n`;
  expect(await build({ "main.cjs": text }, ["main.cjs"], ["--explain"])).toEqual({
    said: ["note: Silenced by bun-ignore: TS100064"],
    exitCode: 0,
  });
});

test("a build that computes no such warning calls no comment stale", async () => {
  const text = `// bun-ignore TS100064\nrequire(${path});\n`;
  expect(await build({ "main.cjs": text }, ["main.cjs"], ["--aot-allow-code-from-disk"])).toEqual(nothing);
});

// A file that is in the executable by one path isn't found by another, so no list of entry points makes the warning needless.
const main = { "app/main.cjs": `require(${path});\n`, "app/second.cjs": `module.exports = 2;\n` };
const left = (at: string) => ({ ...main, [at]: `module.exports = 3;\n` });
const both = ["main.cjs", "./second.cjs"];
const computed: Record<string, { files: Record<string, string>; entries?: string[]; links?: Record<string, string> }> =
  {
    "every code file is an entry point": { files: main },
    "one file is left out": { files: left("app/third.cjs") },
    "an addon is the second entry point": {
      files: { ...main, "app/addon.node": "no code" },
      entries: ["main.cjs", "./addon.node"],
    },
    "a data file is the second entry point": {
      files: { ...main, "app/data.json": "{}" },
      entries: ["main.cjs", "./data.json"],
    },
    "an entry point that a link to its folder names": {
      files: left("app/real/plugin.cjs"),
      entries: [...both, "./real/plugin.cjs"],
      links: { "app/plugins": "real" },
    },
    "an entry point that a link names": {
      files: left("app/real/plugin.cjs"),
      entries: [...both, "./real/plugin.cjs"],
      links: { "app/plugin.cjs": "real/plugin.cjs" },
    },
    "code in the project's own node_modules": { files: left("app/node_modules/dep/index.js") },
    "code behind a link named node_modules": {
      files: left("outside/dep/index.js"),
      links: { "app/node_modules": "../outside" },
    },
    "code in a folder whose name begins with a dot": { files: left("app/.made/plugin.cjs") },
    "code behind a link whose name begins with a dot": {
      files: left("outside/plugin.cjs"),
      links: { "app/.made": "../outside" },
    },
    "code behind a link out of the project": {
      files: left("outside/plugin.cjs"),
      links: { "app/plugins": "../outside" },
    },
    "links to an ancestor": {
      files: { ...main, "app/public/page.html": "" },
      links: { "app/public/one": "..", "app/public/two": "..", "app/public/three": "../..", "app/self": "." },
    },
  };
test.each(Object.keys(computed))("a computed import is warned of: %s", async name => {
  const { files, entries = both, links = {} } = computed[name];
  expect(await build(files, entries, [], {}, links, "app")).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test("a computed import in a dependency is warned of where every file of the program is an entry point", async () => {
  const files = {
    ...main,
    "app/main.cjs": `require("dep");\n`,
    "app/node_modules/dep/package.json": JSON.stringify({ name: "dep", main: "index.js" }),
    "app/node_modules/dep/index.js": `require(${path});\n`,
  };
  expect(await build(files, both, [], {}, {}, "app")).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test("a computed import of a program that is itself a package is warned of", async () => {
  const files = {
    "node_modules/tool/package.json": JSON.stringify({ name: "tool", bin: "cli.cjs" }),
    "node_modules/tool/cli.cjs": `require("./extra.cjs");\nrequire(${path});\n`,
    "node_modules/tool/extra.cjs": `module.exports = 1;\n`,
  };
  const entryPoints = ["node_modules/tool/cli.cjs", "node_modules/tool/extra.cjs"];
  expect(await build(files, entryPoints, [], {})).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});

test("a project of one file keeps the warning of a computed import", async () => {
  const files = { "main.cjs": `require(process.argv[2] ?? "some-package");\n` };
  expect(await build(files, ["main.cjs"], [], {})).toEqual({ said: ["warn: TS100064"], exitCode: 0 });
});
