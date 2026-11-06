// Small programs of two or three files about one variable at the top of a file and another file that reaches it while the first has not run to its end: the two need each other, or the first loads or
// calls the second in the middle of its body. A `let` cannot be read ahead of its declaration, a `var` is `undefined` there, a function declared in the file can be called from the start,
// and a store that is made on the way is there when the file goes on. Every line is printed at once, by `console.log` itself.
//
//   the files     modules that import each other, a module that waits in the middle while a job calls the other one, a module that calls a function of the other one in the middle, CommonJS files
//                 that require each other in the middle; the file with the variable is the first to run, or a third file loads either of the two first
//   the variable  `let`, `var` with a value and without, exported where it is declared, in a list, under another name, as the default, or not at all; a member of `exports`, of an object
//                 that takes the place of `module.exports`, a getter on `exports`; declared ahead of the place where the other file comes in, or behind it
//   the road      functions of the file that read and store, declared or held in a variable; the imported name; the namespace object and what lists it; the object that `require` answers with
//   then          the file reads the variable when it goes on, stores to it once more, and the file that runs last asks again
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const system = random.weighted([
    [4, "ring of modules"],
    [3, "a job in the middle"],
    [3, "a call in the middle"],
    [5, "ring of requires"],
  ] as const);
  const value = random.pick(["5", "5", '"t"', "1.5", "null", "[7]"]);
  const attempt = (who: string, text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("${who} THROWS", error.constructor.name);\n}`;
  const entry = random.pick(["p", "p", "third, p first", "third, q first"] as const);

  if (system === "ring of requires") {
    const held = random.weighted([
      [5, "variable"],
      [4, "member"],
      [2, "replaced"],
      [2, "getter"],
    ] as const);
    const isAhead = random.chance(0.5);
    const word = random.pick(["let", "let", "var", "var"]);
    const bare = word === "var" && random.chance(0.4);
    const declaration = held === "variable" || held === "getter" ? `${word} x${bare ? "" : " = 1"};` : "";
    const functions = random.pick(["arrows", "declared", "declared"] as const);
    const hands =
      held === "variable"
        ? functions === "arrows"
          ? "exports.peek = () => x;\nexports.poke = given => {\nx = given;\n};"
          : random.pick([
              "exports.peek = peek;\nexports.poke = poke;",
              "Object.assign(exports, { peek, poke });",
              "module.exports = { peek, poke };",
            ])
        : held === "getter"
          ? 'Object.defineProperty(exports, "x", {\nget() {\nreturn x;\n},\nset(given) {\nx = given;\n},\nenumerable: true,\n});'
          : held === "member"
            ? ""
            : "";
    const declaredFunctions =
      held === "variable" && functions === "declared"
        ? "function peek() {\nreturn x;\n}\nfunction poke(given) {\nx = given;\n}"
        : "";
    const member = held === "member" ? "exports.x = 1;" : held === "replaced" ? "module.exports = { x: 1 };" : "";
    const own =
      held === "variable" || held === "getter"
        ? "x"
        : held === "member"
          ? random.pick(["exports.x", "module.exports.x", "this.x"])
          : "module.exports.x";
    const p = [
      hands,
      isAhead ? declaration || member : "",
      random.pick(['const q = require("./q.cjs");', 'require("./q.cjs");', 'const { again } = require("./q.cjs");']),
      attempt("p", `console.log("p goes on", ${own});`),
      isAhead ? "" : declaration || member,
      random.chance(0.5)
        ? attempt("p", `${own}${random.pick([" = 2", "++", ' += "!"'])};\nconsole.log("p", ${own});`)
        : "",
      declaredFunctions,
    ]
      .filter(Boolean)
      .join("\n");
    const reads =
      held === "variable"
        ? ['console.log("q", p.peek());', 'console.log("q", typeof p.peek, Object.keys(p).join());']
        : [
            'console.log("q", p.x);',
            'console.log("q", Object.keys(p).join());',
            'console.log("q", JSON.stringify(p));',
            'console.log("q", "x" in p, p.x);',
            '{\nconst { x } = p;\nconsole.log("q", x);\n}',
          ];
    const stores =
      held === "variable"
        ? [`p.poke(${value});`]
        : [
            `p.x = ${value};`,
            `p.x = ${value};`,
            `Object.assign(p, { x: ${value} });`,
            `p["x"] = ${value};`,
            "delete p.x;",
            `Object.defineProperty(p, "x", { value: ${value}, writable: true, enumerable: true, configurable: true });`,
          ];
    const q = [
      'const p = require("./p.cjs");',
      random.chance(0.7) ? attempt("q", random.pick(reads)) : "",
      attempt("q", random.pick(stores)),
      random.chance(0.6) ? attempt("q", random.pick(reads)) : "",
      `exports.again = function () {\n${attempt("q", random.pick(reads).replace('"q"', '"q again"'))}\n};`,
    ]
      .filter(Boolean)
      .join("\n");
    const last = `require("./q.cjs").again();`;
    if (entry === "p") return { file: "p.cjs", text: `${p}\n${last}\n`, files: { "q.cjs": q + "\n" } };
    const third = `require("./${entry === "third, p first" ? "p" : "q"}.cjs");\n${last}\n${attempt("main", `console.log("main", JSON.stringify(require("./p.cjs")));`)}\n`;
    return {
      file: random.pick(["main.cjs", "main.cjs", "main.mjs"]),
      text: third,
      files: { "p.cjs": p + "\n", "q.cjs": q + "\n" },
    };
  }

  const form = random.weighted([
    [4, "export let x = 1;"],
    [3, "export var x = 1;"],
    [2, "export var x;"],
    [2, "let x = 1;\nexport { x };"],
    [1, "var x = 1;\nexport { x };"],
    [2, "let x = 1;\nexport { x as y };"],
    [2, "let x = 1;\nexport { x as default };"],
    [2, "let x = 1;\nexport default x;"],
    [3, "let x = 1;"],
    [2, "var x = 1;"],
    [1, "var x;"],
  ]);
  const name = form.includes("as y") ? "y" : form.includes("default") ? "default" : form.includes("export") ? "x" : "";
  const functions = random.pick([
    "export function peek() {\nreturn x;\n}\nexport function poke(given) {\nx = given;\n}",
    "export function peek() {\nreturn x;\n}\nexport function poke(given) {\nx = given;\n}",
    "export { peek, poke };\nfunction peek() {\nreturn x;\n}\nfunction poke(given) {\nx = given;\n}",
  ]);
  const road = name
    ? random.pick(["functions", "functions", "name", "name", "namespace", "namespace"] as const)
    : "functions";
  const local = name === "default" ? "byDefault" : name;
  const imports = {
    functions: 'import { peek, poke } from "./p.mjs";',
    name:
      name === "default" ? 'import byDefault, { poke } from "./p.mjs";' : `import { ${name}, poke } from "./p.mjs";`,
    namespace: 'import * as P from "./p.mjs";\nconst { poke } = P;',
  }[road];
  const reads = {
    functions: ['console.log("q", peek());', 'console.log("q", peek());', 'console.log("q", typeof peek());'],
    name: [
      `console.log("q", ${local});`,
      `console.log("q", ${local});`,
      `console.log("q", typeof ${local});`,
      `console.log("q", [${local}].length, ${local});`,
    ],
    namespace: [
      `console.log("q", P.${name});`,
      `console.log("q", P.${name});`,
      `console.log("q", P["${name}"]);`,
      'console.log("q", Object.keys(P).join());',
      `console.log("q", "${name}" in P, typeof P.peek);`,
      `console.log("q", Reflect.get(P, "${name}"));`,
      `console.log("q", Object.getOwnPropertyDescriptor(P, "${name}").value);`,
      'console.log("q", Object.values(P).length);',
      'console.log("q", Object.keys({ ...P }).join());',
      `{\nconst { ${name}: taken } = P;\nconsole.log("q", taken);\n}`,
    ],
  }[road];
  const asks = () =>
    [
      random.chance(0.7) ? attempt("q", random.pick(reads)) : "",
      attempt("q", `poke(${value});`),
      random.chance(0.7) ? attempt("q", random.pick(reads)) : "",
    ]
      .filter(Boolean)
      .join("\n");
  const again = `export function again() {\n${attempt("q", random.pick(reads).replace('"q"', '"q again"'))}\n}`;
  const goesOn = [
    attempt("p", 'console.log("p goes on", x);'),
    random.chance(0.5) ? attempt("p", `x${random.pick([" = 2", "++", ' += "!"'])};\nconsole.log("p", x);`) : "",
  ]
    .filter(Boolean)
    .join("\n");
  const isAhead = random.chance(0.5);

  let p: string;
  let q: string;
  if (system === "ring of modules") {
    p = [random.pick(['import "./q.mjs";', 'import { again } from "./q.mjs";']), form, goesOn, functions].join("\n");
    q = [imports, asks(), again].join("\n");
  } else {
    const handed = random.chance(0.5);
    p = [
      'import { run } from "./q.mjs";',
      isAhead ? form : "",
      system === "a job in the middle"
        ? `${random.pick(["queueMicrotask(() => run(peek, poke));", "Promise.resolve().then(() => run(peek, poke));", "process.nextTick(run, peek, poke);"])}\nawait null;`
        : attempt("p", handed ? "run(\n() => x,\ngiven => {\nx = given;\n},\n);" : "run(peek, poke);"),
      goesOn,
      isAhead ? "" : form,
      functions,
    ]
      .filter(Boolean)
      .join("\n");
    q = [
      `export function run(peek, poke) {\n${[
        random.chance(0.7) ? attempt("q", 'console.log("q", peek());') : "",
        attempt("q", `poke(${value});`),
        random.chance(0.7) ? attempt("q", 'console.log("q", peek());') : "",
      ]
        .filter(Boolean)
        .join("\n")}\n}`,
      'export function again() {\nconsole.log("q again");\n}',
    ].join("\n");
  }
  if (entry === "p") {
    const last = p.includes("{ again }") ? "again();" : "";
    return { file: "p.mjs", text: `${p}${last ? "\n" + last : ""}\n`, files: { "q.mjs": q + "\n" } };
  }
  const third = [
    ...(entry === "third, p first"
      ? ['import { peek } from "./p.mjs";', 'import { again } from "./q.mjs";']
      : ['import { again } from "./q.mjs";', 'import { peek } from "./p.mjs";']),
    "again();",
    attempt("main", 'console.log("main", peek());'),
  ].join("\n");
  return { file: "main.mjs", text: third + "\n", files: { "p.mjs": p + "\n", "q.mjs": q + "\n" } };
}
