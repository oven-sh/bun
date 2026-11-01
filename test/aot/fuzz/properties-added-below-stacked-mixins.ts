// Classes over a stack of mixins, where one mixin may stand in the stack more than once, so that its class may lie above
// itself. An instance of such a class, of the root or of a class between then gets a property that no class declares, and
// the program reads it back in every way. The scene stands in a function that may run more than once.
import type { Random } from "./random";

const rootBodies = [
  "",
  "r = 1;",
  "#p = 5;\np() {\nreturn this.#p;\n}",
  'constructor() {\nthis.made = "root";\n}',
  'static s = 1;\nwho() {\nreturn "root";\n}',
];
const mixinBodies = [
  "",
  "m = 2;",
  'hello() {\nreturn "m";\n}',
  "#q = 3;\nq() {\nreturn this.#q;\n}",
  "n = (this.n ?? 0) + 1;",
  "constructor(...given) {\nsuper(...given);\nthis.count = (this.count ?? 0) + 1;\n}",
  'who() {\nreturn "mixin over " + (super.who?.() ?? "nothing");\n}',
];
const leafBodies = ["", "l = 7;", "constructor() {\nsuper();\nthis.late = 1;\n}", "#z = 8;\nz() {\nreturn this.#z;\n}"];
const stacks = ["A", "AA", "AB", "AAA", "ABA", "BAA", "ABBA"];
const stores: ((object: string) => string)[] = [
  object => `${object}.acc = 9;`,
  object => `${object}["acc"] = 9;`,
  object => `Object.assign(${object}, { acc: 9 });`,
  object => `set(${object});`,
  object => `${object}.acc = 9;\n${object}.more = "text";`,
  object => `${object}.acc = 9;\ndelete ${object}.acc;\n${object}.acc = 10;`,
  object =>
    `Object.defineProperty(${object}, "acc", { value: 9, enumerable: true, writable: true, configurable: true });`,
  object => `if (round) ${object}.acc = 9;`,
  object => `${object}.acc ??= 9;`,
  object => `for (const key of ["acc", "bcc"]) ${object}[key] = key.length;`,
];
const reads = ["acc", "more", "bcc", "r", "m", "n", "l", "late", "made", "count"];
const calls = ["p", "q", "z", "hello", "who"];

export function generate(random: Random): { file: string; text: string } {
  const placeOfRoot = random.pick(["maker", "scene", "top"] as const);
  const root = `class Root {\n${random.pick(rootBodies)}\n}`;
  const mixins = ["A", "B"]
    .map(name => `const mix${name} = Base =>\nclass extends Base {\n${random.pick(mixinBodies)}\n};`)
    .join("\n");
  const mixinsStandAtTop = random.chance(0.3);
  const made = [...random.pick(stacks)].reduceRight((inner, name) => `mix${name}(${inner})`, "Root");
  const names = ["SA", "SB", "SC"].slice(0, random.pick([1, 2, 2, 2, 3]));
  const last = names[names.length - 1];
  const isChain = names.length > 1 && random.chance(0.25);
  const sharesBase = random.chance(0.3);
  const targets = random.pick([
    ["o"],
    ["o"],
    ["root"],
    ["o", "root"],
    ["between"],
    ["o", "between"],
    ["other"],
    ["o", "other"],
  ]);
  const store = random.pick(stores);
  const seen = [...new Set(["o", ...targets])];
  const scene = [
    placeOfRoot === "maker" ? `function makeRoot() {\nreturn ${root};\n}\nconst Root = makeRoot();` : "",
    placeOfRoot === "scene" ? root : "",
    mixinsStandAtTop ? "" : mixins,
    `const make = () => ${made};`,
    sharesBase ? "const Base = make();" : "",
    ...names.map((name, position) => {
      const parent = isChain && position ? names[position - 1] : sharesBase ? "Base" : "make()";
      return `class ${name} extends ${parent} {\n${random.pick(leafBodies)}\n}`;
    }),
    `const o = new ${last}();`,
    targets.includes("root") ? "const root = new Root();" : "",
    targets.includes("between") ? "const between = new (make())();" : "",
    targets.includes("other") ? `const other = new ${names[0]}();` : "",
    ...targets.map(store),
    ...seen.map(
      name =>
        `say("${name}", ${reads.map(key => `${name}.${key}`).join(", ")}, "acc" in ${name}, Object.keys(${name}), JSON.stringify(${name}), ${calls.map(key => `${name}.${key}?.()`).join(", ")});`,
    ),
    `say("is", ${names.map(name => `o instanceof ${name}`).join(", ")}, o instanceof Root, new ${names[0]}().acc);`,
  ]
    .filter(Boolean)
    .join("\n");
  const head = [
    'const say = (...all) => console.log(...all.map(one => (typeof one === "object" ? JSON.stringify(one) : String(one))));',
    "function set(object) {\nobject.acc = 9;\n}",
    placeOfRoot === "top" ? root : "",
    mixinsStandAtTop ? mixins : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    file: random.chance(0.5) ? "main.mjs" : "main.cjs",
    text: `${head}\nfunction run(round) {\n${scene}\n}\nfor (let round = 0; round < ${random.pick([1, 2, 2, 3])}; round++) run(round);\n`,
  };
}
