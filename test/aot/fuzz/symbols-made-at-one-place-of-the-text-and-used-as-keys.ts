// Small programs about symbols that one place of the text makes, once or several times, and members that stand under them. Every call of `Symbol(..)` makes a new symbol, whatever its description and
// wherever it is written; `Symbol.for(..)` answers with the same one. Two symbols are two keys. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   made by      a `const` at the top of the file, a function that is called twice, an arrow, a loop, a `let` that is stored to again, either arm of a condition, a static field, a `const` in a
//                function that runs three times, a class that a function makes twice, another file that two files import, `Symbol.for`, `Symbol()` without a description
//   used in      a store, a literal, a field of a class, a method, a getter, `Object.defineProperty`, `Object.assign`; on one object or on one object a symbol
//   asked        the members under each symbol, whether the symbols are the same, how many symbols the object has and in which order, `in`, `delete` of one and a read of the other, a copy,
//                the descriptions
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files?: Record<string, string> } {
  const call = random.pick(['Symbol("k")', 'Symbol("k")', 'Symbol("k")', "Symbol()", 'Symbol.for("k")']);
  const makers: [number, string][] = [
    [4, `function make() {\nreturn ${call};\n}\nconst first = make();\nconst second = make();`],
    [2, `const make = () => ${call};\nconst first = make();\nconst second = make();`],
    [3, `const made = [];\nfor (let turn = 0; turn < 2; turn++) made.push(${call});\nconst [first, second] = made;`],
    [2, `const [first, second] = [0, 1].map(() => ${call});`],
    [2, `let key = ${call};\nconst first = key;\nkey = ${call};\nconst second = key;`],
    [2, `const pick = flag => (flag ? ${call} : ${call});\nconst first = pick(true);\nconst second = pick(false);`],
    [2, `const first = ${call},\nsecond = ${call};`],
    [
      2,
      `class Holder {\nstatic key = ${call};\n}\nclass Other {\nstatic key = ${call};\n}\nconst first = Holder.key;\nconst second = Other.key;`,
    ],
    [
      2,
      `function classWithAKey() {\nreturn class {\nstatic key = ${call};\n};\n}\nconst first = classWithAKey().key;\nconst second = classWithAKey().key;`,
    ],
    [
      1,
      `function* keys() {\nfor (;;) yield ${call};\n}\nconst source = keys();\nconst first = source.next().value;\nconst second = source.next().value;`,
    ],
    [1, `const first = ${call};\nconst second = Object(first).valueOf();`],
    [1, `const first = ${call};\nconst second = Symbol(first.description);`],
  ];
  const maker = random.weighted(makers);
  const uses: [number, string][] = [
    [5, "const o = {};\no[first] = 1;\no[second] = 2;"],
    [4, "const o = { [first]: 1, [second]: 2 };"],
    [2, "const o = { [second]: 2, a: 0, [first]: 1 };"],
    [3, "class K {\n[first] = 1;\n[second] = 2;\n}\nconst o = new K();"],
    [
      2,
      "class K {\n[first]() {\nreturn 1;\n}\n[second]() {\nreturn 2;\n}\n}\nconst o = {\nget [first]() {\nreturn new K()[first]();\n},\nget [second]() {\nreturn new K()[second]();\n},\n};",
    ],
    [2, "const o = {\nget [first]() {\nreturn 1;\n},\nget [second]() {\nreturn 2;\n},\n};"],
    [
      2,
      "const o = {};\nObject.defineProperty(o, first, { value: 1, enumerable: true, configurable: true, writable: true });\nObject.defineProperty(o, second, { value: 2, enumerable: true, configurable: true, writable: true });",
    ],
    [2, "const o = Object.assign({}, { [first]: 1 }, { [second]: 2 });"],
    [2, "const o = { [first]: 1 };\no[second] = 2;"],
    [1, "const o = {};\nfor (const [key, value] of [\n[first, 1],\n[second, 2],\n])\no[key] = value;"],
    [1, "function K() {\nthis[first] = 1;\nthis[second] = 2;\n}\nconst o = new K();"],
  ];
  const use = random.weighted(uses);
  const asks = [
    "console.log(o[first], o[second]);",
    "console.log(o[first], o[second]);",
    "console.log(first === second, Object.is(first, second));",
    "console.log(Object.getOwnPropertySymbols(o).length, Reflect.ownKeys(o).length);",
    "console.log(Object.getOwnPropertySymbols(o)[0] === first, Object.getOwnPropertySymbols(o).at(-1) === second);",
    "console.log(first in o, second in o, Object.hasOwn(o, second));",
    "console.log(delete o[first], o[first], o[second]);",
    "console.log(delete o[second], o[first], o[second]);",
    "{\nconst copy = { ...o };\nconsole.log(copy[first], copy[second], Object.getOwnPropertySymbols(copy).length);\n}",
    "console.log(String(first.description), String(second.description), first.toString() === second.toString());",
    "o[first] = 5;\nconsole.log(o[first], o[second]);",
    "o[second] = 5;\nconsole.log(o[first], o[second]);",
    "console.log(JSON.stringify(o), Object.keys(o).length);",
    "console.log(new Set([first, second]).size, new Map([\n[first, 1],\n[second, 2],\n]).get(first));",
    "{\nconst { [first]: one, [second]: two } = o;\nconsole.log(one, two);\n}",
    "{\nconst { [first]: one, ...others } = o;\nconsole.log(one, Object.getOwnPropertySymbols(others).length, others[second]);\n}",
    "console.log(Object.getOwnPropertyDescriptor(o, first)?.value, Object.getOwnPropertyDescriptor(o, second)?.value);",
  ];
  const told = random.sample(asks, random.pick([1, 2, 2, 3])).join("\n");
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  const isModule = random.chance(0.5);
  const file = isModule ? "main.mjs" : "main.cjs";

  const form = random.weighted([
    [6, "plain"],
    [2, "kept outside"],
    [2, "files"],
  ] as const);
  if (form === "kept outside") {
    // A `const` of a function that runs three times, and an object outside that takes a member each time.
    return {
      file,
      text: `const o = {};\nconst all = [];\nfunction run(value) {\nconst key = ${call};\nall.push(key);\no[key] = value;\n}\n${guarded(`run(1);\nrun(2);\nrun(3);\nconsole.log(Object.getOwnPropertySymbols(o).length, o[all[0]], o[all[1]], o[all[2]], all[0] === all[1]);`)}\n`,
    };
  }
  if (form === "files") {
    const keys = `export const key = ${call};\nexport function make() {\nreturn ${call};\n}\n`;
    const a = 'import { key, make } from "./keys.mjs";\nexport const first = key;\nexport const made = make();\n';
    const b = 'import { key, make } from "./keys.mjs";\nexport const second = key;\nexport const made = make();\n';
    return {
      file: "main.mjs",
      text: `import { first, made as one } from "./a.mjs";\nimport { second, made as two } from "./b.mjs";\n${guarded(`const o = { [first]: 1, [one]: 2 };\no[second] = 3;\no[two] = 4;\nconsole.log(first === second, one === two, Object.getOwnPropertySymbols(o).length, o[first], o[one], o[two]);`)}\n`,
      files: { "keys.mjs": keys, "a.mjs": a, "b.mjs": b },
    };
  }
  const scene = `${maker}\n${use}\n${told}`;
  const where = random.pick(["top", "top", "once", "thrice", "keys outside"] as const);
  if (where === "top") return { file, text: `${guarded(scene)}\n` };
  if (where === "keys outside")
    return { file, text: `${maker}\nfunction run() {\n${use}\n${told}\n}\n${guarded("run();\nrun();")}\n` };
  return {
    file,
    text: `function run() {\n${scene}\n}\n${guarded(where === "once" ? "run();" : "run();\nrun();\nrun();")}\n`,
  };
}
