// The text of a function leaves out what `bun build` folds away: of `true ? a : b` it keeps `a`. What is kept has to mean there
// what the whole meant: `(a) => true ? { a } : 0` is `(a) => ({ a })`, not `(a) => { a }`, and `(true ? o.m : 0)()` is
// `(0, o.m)()`, not `(o.m)()`. Each cell is a folded form at a position: its text, evaluated again, answers as the function does.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const folded: ((kept: string) => string)[] = [
  kept => `true ? ${kept} : 0`,
  kept => `false ? 0 : ${kept}`,
  kept => `true && ${kept}`,
  kept => `false || ${kept}`,
  kept => `null ?? ${kept}`,
  kept => `true ? true && ${kept} : 0`,
];
const object = `const o = { v: a, m() { return this === o ? "o" : typeof this; } };`;
const positions: [(whole: string) => string, string[]][] = [
  [
    e => `(a) => ${e}`,
    [
      "{ a }",
      "{ a }.a",
      "{}",
      "{ a, b: { a } }",
      "function () { return a; }()",
      "class { static v = a; }.v",
      "a",
      "[a]",
      "() => a",
      "(1, a)",
      "a = 5",
      "{ a } = { a: 5 }",
    ],
  ],
  [e => `async (a) => ${e}`, ["{ a }"]],
  [e => `(a) => /* c */ ${e}`, ["{ a }"]],
  [e => `(a) => () => ${e}`, ["{ a }"]],
  [
    e => `function (a) { let r = 1; ${e}; return r; }`,
    [
      "{ a }",
      "{ a }.a",
      "function () { r = a; }()",
      "class { static v = (r = a); }.v",
      "async function () {}",
      "r = a",
      "[r] = [a]",
      "{ r } = { r: a }",
      "{ a }.a = 1",
    ],
  ],
  [e => `(a) => { let r = 1; ${e}; return r; }`, ["{ a }", "function () { r = a; }()"]],
  [e => `function (a) { let r = 1; ${e}, r = a; return r; }`, ["{ a }", "function () {}", "class {}"]],
  [e => `function (a) { let r = 1; if (a) ${e}; return r; }`, ["{ a }", "function () { r = a; }()"]],
  [e => `function (a) { let r = 1; l: ${e}; return r; }`, ["{ a }", "function () { r = a; }()"]],
  [e => `function (a) { ${object} return (${e})(); }`, ["o.m", "o['m']", "o?.m", "(o.m)"]],
  [e => `function (a) { ${object} return (${e})?.(); }`, ["o.m"]],
  [e => `function (a) { ${object} return ((${e}))(); }`, ["o.m"]],
  [e => `function (a) { return (${e})("typeof a"); }`, ["eval"]],
  [e => `function (a) { const o = { a }; delete (${e}); return "a" in o; }`, ["o.a", "o['a']"]],
  [e => `function (a) { try { return typeof (${e}); } catch (e) { return e.name; } }`, ["nobodyDeclaresThis"]],
  [
    e => `function (a) { const o = { a }; let n = 0; for (let i = ${e}; i && n < 2; n++); return n; }`,
    ['"a" in o', 'a && "a" in o', "a"],
  ],
  [
    e => `function (a) { const o = { a }; let n = 0, i; for (i = ${e}; i && n < 2; n++); return n; }`,
    ['"a" in o', "{ a }"],
  ],
  [
    e => `function (a) { const o = { a }; let n = 0; for (${e}; n < 2; n++); return n; }`,
    ['"a" in o', "{ a }", "{ a }.a in o"],
  ],
  [e => `function (a) { function F() { return function G() { this.v = a; }; } return new (${e})().v; }`, ["F()"]],
  [e => `function (a) { return (${e}) ** 2; }`, ["-a", "-2"]],
  [e => `function (a) { return (${e}).toFixed(1); }`, ["5", "-5", "a"]],
  [e => `function (a) { return JSON.stringify([${e}]); }`, ["(1, a)", "{ a }"]],
  [e => `function (a, b = ${e}) { return b; }`, ["{ a }"]],
  [e => `function (a) { return ${e}; }`, ["{ a }", "function () { return a; }()", "(1, a)"]],
  [e => `function (a) { return new (class { v = ${e}; })().v; }`, ["{ a }"]],
  [e => "function (a) { return `${" + e + "}`; }", ["{ a }.a"]],
];

function isWritable(text: string) {
  try {
    new Function(`return (${text})`);
    return true;
  } catch {
    return false;
  }
}
const cells = positions
  .flatMap(([place, kept]) => kept.flatMap(kept => folded.map(fold => place(fold(kept)))))
  .filter(isWritable);

// A define puts a value where a name stood.
const defines = {
  OBJ: `{"a":1}`,
  EMPTY: "{}",
  ARR: "[1,2]",
  NEG: "-1",
  NUM: "5",
  FRAC: "1.5",
  STR: `"s"`,
  UNDEF: "undefined",
  NUL: "null",
  BOOL: "true",
};
const defined = [
  ...[
    "OBJ",
    "OBJ.a",
    `OBJ["a"]`,
    "EMPTY",
    "[OBJ]",
    "({ OBJ })",
    "`${OBJ.a}`",
    "ARR",
    "ARR[0]",
    "typeof OBJ",
    "a in OBJ",
    "NEG in OBJ",
  ],
  ...[
    "NEG ** 2",
    "NEG**2",
    "(NEG) ** 2",
    "2 ** NEG",
    "NEG.toFixed(1)",
    `NEG["toFixed"](1)`,
    "NUM.toFixed(1)",
    `NUM["toFixed"](1)`,
    "FRAC.toFixed(1)",
  ],
  ...[
    "-NEG",
    "- NEG",
    "+NEG",
    "a-NEG",
    "a - NEG",
    "a+NUM",
    "a- -NEG",
    "a*NEG",
    "a/NUM",
    "typeof NEG",
    "void NEG",
    "a ? NEG : NUM",
  ],
  ...[
    "STR.length",
    "STR[0]",
    "UNDEF?.x",
    "NUL ?? a",
    "NUL ?? { a }",
    "BOOL ? { a } : 0",
    "BOOL && { a }",
    "!BOOL || { a }",
    "BOOL ? OBJ : 0",
    "!BOOL",
    "!!BOOL",
  ],
]
  .map(body => `(a) => ${body}`)
  .concat([
    `function (a) { OBJ; return a; }`,
    `function (a) { OBJ.a; return a; }`,
    `function (a) { let r = 1; OBJ.a, r = a; return r; }`,
    `function (a) { let r = 1; BOOL ? function () { r = a; }() : 0; return r; }`,
    `function (a) { ${object} return (BOOL ? o.m : 0)(); }`,
    `function (a) { let n = 0; for (let i = BOOL ? "a" in OBJ : 0; i && n < 2; n++); return n; }`,
    `function (a) { let n = 0; for (let i = BOOL ? "a" in EMPTY : 1; i && n < 2; n++); return n; }`,
  ]);

const programOf = (cells: string[]) => `const cells = [\n${cells.map(cell => `  ${cell},\n`).join("")}];
const show = async value => {
  try { value = await value; } catch (error) { return "rejects " + error.name; }
  if (typeof value === "function") { try { return "a function: " + (await show(value())); } catch (error) { return "a function that throws " + error.name; } }
  return value === undefined ? "undefined" : JSON.stringify(value);
};
const answer = async f => { try { return await show(f(7)); } catch (error) { return "throws " + error.name; } };
for (const f of cells) {
  const text = String(f);
  let again;
  try { again = await answer((0, eval)('"use strict"; (' + text + ")")); } catch (error) { again = "the text: " + error.name; }
  const first = await answer(f);
  if (first !== again) console.log(text.replace(/\\s+/g, " "), "|", first, "|", again);
}
console.log("cells", cells.length);
`;

async function expectTextsToMeanTheSame(cells: string[], flags: string[]) {
  using dir = tempDir("folded-function-text", { "main.mjs": programOf(cells) });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "main.exe" : "main");
  const expected = `cells ${cells.length}\n`;
  expect((await run([bunExe(), "run", ...flags, "main.mjs"], cwd, bunEnv)).stdout).toBe(expected);
  const build = [bunExe(), "build", "--compile", "--aot", ...flags, "main.mjs", "--outfile", executable];
  const built = await run(build, cwd, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  expect((await run([executable], cwd, bunEnv)).stdout).toBe(expected);
}

test("what is kept of a folded expression means what the whole meant", async () => {
  expect(cells.length).toBeGreaterThan(300);
  await expectTextsToMeanTheSame(cells, []);
}, 240_000);

test("a value that a define puts there means what the name meant", async () => {
  const flags = Object.entries(defines).flatMap(([name, value]) => ["--define", `${name}=${value}`]);
  await expectTextsToMeanTheSame(defined, flags);
}, 240_000);
