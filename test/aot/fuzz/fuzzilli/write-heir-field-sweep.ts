// The least programs with classes below classes whose instances get a field late: the class above, times the classes below, times who adds the field, times what it holds, times which instances meet, times what is asked, times the loop.
//
//   bun write-heir-field-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<above>--<below>--<added>--<value>--<met>--<asked>--<loop>.mjs, .cjs or .ts
//   bun write-heir-field-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// V is what the late field `z` holds; `x` is handed over.
const aboves: [name: string, text: string][] = [
  ["one-field", "class A {\n  constructor(x) {\n    this.a = x;\n    ABOVE\n  }\n  METHODS\n}"],
  ["two-fields", "class A {\n  constructor(x) {\n    this.a = x;\n    this.b = x + 1;\n    ABOVE\n  }\n  METHODS\n}"],
  ["class-field", "class A {\n  a = 1;\n  constructor(x) {\n    ABOVE\n  }\n  METHODS\n}"],
  ["empty", "class A {\n  constructor(x) {\n    ABOVE\n  }\n  METHODS\n}"],
  [
    "private",
    "class A {\n  #p = 1;\n  constructor(x) {\n    this.a = x;\n    ABOVE\n  }\n  get p() {\n    return this.#p;\n  }\n  METHODS\n}",
  ],
  ["sometimes", "class A {\n  constructor(x) {\n    if (x & 1) this.a = x;\n    ABOVE\n  }\n  METHODS\n}"],
  [
    "eight",
    "class A {\n  constructor(x) {\n    this.a = x;\n    this.f1 = 1;\n    this.f2 = 2;\n    this.f3 = 3;\n    this.f4 = 4;\n    this.f5 = 5;\n    ABOVE\n  }\n  METHODS\n}",
  ],
];
const belows: [name: string, text: string][] = [
  [
    "one",
    "class B extends A {\n  constructor(x) {\n    super(x);\n    this.c = x * 2;\n    BELOW\n  }\n}\nclass C extends B {}",
  ],
  [
    "two",
    "class B extends A {\n  constructor(x) {\n    super(x);\n    this.c = x * 2;\n    BELOW\n  }\n}\nclass C extends A {\n  constructor(x) {\n    super(x);\n    this.d = 't' + x;\n    this.c = 0.5;\n  }\n}",
  ],
  [
    "deep",
    "class B extends A {\n  constructor(x) {\n    super(x);\n    BELOW\n    this.c = x * 2;\n  }\n}\nclass C extends B {\n  constructor(x) {\n    super(x + 1);\n    this.d = x;\n  }\n}",
  ],
  ["fields", "class B extends A {\n  c = 2;\n}\nclass C extends A {\n  d = 3;\n  c = 4;\n}"],
  ["without", "class B extends A {}\nclass C extends A {}"],
  ["own-late", "class B extends A {\n  z = 'own';\n}\nclass C extends A {\n  c = 4;\n}"],
  [
    "accessor",
    "class B extends A {\n  get z() {\n    return this.y ?? 'none';\n  }\n  set z(v) {\n    this.y = v;\n  }\n}\nclass C extends A {\n  c = 4;\n}",
  ],
  ["method", "class B extends A {\n  z() {\n    return 8;\n  }\n}\nclass C extends B {\n  c = 4;\n}"],
  [
    "array",
    "class B extends A {\n  c = 2;\n}\nclass C extends Array {\n  constructor(x) {\n    super();\n    this.a = x;\n  }\n  grow(x) {\n    this.z = x;\n  }\n  more(x) {\n    this.y = x;\n  }\n}",
  ],
  [
    "functions",
    "function B(x) {\n  this.a = x;\n  this.c = 1;\n}\nB.prototype = Object.create(A.prototype);\nfunction C(x) {\n  this.c = x;\n}\nObject.setPrototypeOf(C.prototype, A.prototype);",
  ],
  [
    "returned",
    "class B extends A {\n  constructor(x) {\n    super(x);\n    if (x === 1) return new A(x);\n    this.c = 3;\n  }\n}\nclass C extends B {\n  d = 1;\n}",
  ],
];
// Where the late field is added: in the class above, in the class below, in a method, behind the birth.
const addeds: [name: string, above: string, below: string, methods: string, behind: string][] = [
  ["method", "", "", "grow(x) {\n    this.z = V;\n  }", "o.grow(i);"],
  [
    "two-methods",
    "",
    "",
    "grow(x) {\n    this.z = V;\n  }\n  more(x) {\n    this.y = x;\n  }",
    "if (i & 1) o.more(i);\no.grow(i);\nif (!(i & 1)) o.more(i);",
  ],
  ["outside", "", "", "", "put(o, i);"],
  ["by-turn", "", "", "grow(x) {\n    this.z = V;\n  }", "if (i & 1) o.grow(i);"],
  ["above", "this.z = V;", "", "", ""],
  ["above-sometimes", "if (x > 0) this.z = V;", "", "", ""],
  ["below", "", "this.z = V;", "", ""],
  ["called-above", "this.grow(x);", "", "grow(x) {\n    this.z = V;\n  }", ""],
  ["at-once", "", "", "", "o.z = i;"],
  ["before-other", "", "", "", "o.y = i;\nput(o, i);"],
  ["assigned", "", "", "", "Object.assign(o, { z: i, y: 2 });"],
  ["by-key", "", "", "", "o[key] = i;"],
  ["many", "", "", "grow(x) {\n    for (let k = 0; k < 6; k++) this['k' + k] = k;\n    this.z = V;\n  }", "o.grow(i);"],
  ["removed-again", "", "", "grow(x) {\n    this.z = V;\n  }", "o.grow(i);\nif (i === 2) delete o.z;"],
  ["replaced", "", "", "grow(x) {\n    this.z = V;\n  }", "o.grow(i);\no.grow(i + 1);"],
];
const values: [name: string, text: string][] = [
  ["integer", "x + 5"],
  ["fraction", "x + 0.5"],
  ["text", "'t' + x"],
  ["object", "{ v: x }"],
  ["kinds", "x & 1 ? 't' : x"],
  ["numbers", "x & 1 ? 0.25 : x"],
  ["undefined", "x & 1 ? undefined : x"],
  ["large", "x * 3e9"],
  ["list", "[x]"],
  ["big", "BigInt(x | 0)"],
];
const mets: [name: string, text: string][] = [
  ["below", "new B(i)"],
  ["alternating", "i & 1 ? new B(i) : new A(i)"],
  ["above-first", "i === 0 ? new A(i) : new B(i)"],
  ["both-below", "i & 1 ? new B(i) : new C(i)"],
  ["all", "i % 3 === 0 ? new A(i) : i % 3 === 1 ? new B(i) : new C(i)"],
  ["lowest", "new C(i)"],
  ["above", "new A(i)"],
  ["given", "new classes[i % 3](i)"],
];
const asks: [name: string, text: string][] = [
  ["late", "O.z"],
  ["first", "O.a"],
  ["below", "O.c"],
  ["sum", "O.a + '|' + O.z + '|' + O.c"],
  ["names", "Object.keys(O).join()"],
  ["has", "'z' in O"],
  ["own", "Object.hasOwn(O, 'z')"],
  ["all", "JSON.stringify({ ...O, z: said(O.z) })"],
  ["typed", "typeof O.z"],
  ["asked", "ask(O)"],
  ["second-late", "O.y"],
  ["object", "O.z?.v"],
];
const loops: [name: string, text: string][] = [
  ["at-once", "for (let i = 0; i < n; i++) {\n  MAKE\n  ADD\n  out.push(said(ASK));\n}"],
  ["before", "for (let i = 0; i < n; i++) {\n  MAKE\n  out.push(said(ASK));\n  ADD\n}"],
  ["around", "for (let i = 0; i < n; i++) {\n  MAKE\n  out.push(said(ASK));\n  ADD\n  out.push(said(ASK));\n}"],
  [
    "listed",
    "const all = [];\nfor (let i = 0; i < n; i++) {\n  MAKE\n  ADD\n  all.push(o);\n}\nfor (const o of all) out.push(said(ASK));",
  ],
  [
    "added-behind",
    "const all = [];\nfor (let i = 0; i < n; i++) {\n  MAKE\n  all.push(o);\n}\nfor (let i = 0; i < n; i++) {\n  const o = all[i];\n  ADD\n}\nfor (const o of all) out.push(said(ASK));",
  ],
  [
    "twice",
    "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < n; i++) {\n    MAKE\n    ADD\n    if (k) out.push(said(ASK));\n  }",
  ],
  [
    "last",
    "for (let i = 0; i < n; i++) {\n  MAKE\n  ADD\n  last = o;\n}\n{\n  const o = last;\n  out.push(said(ASK));\n}",
  ],
];
const total = aboves.length * belows.length * addeds.length * values.length * mets.length * asks.length * loops.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 4_851_001;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const added = pick(addeds);
  const below = pick(belows);
  const met = pick(mets);
  const value = pick(values);
  const above = pick(aboves);
  const loop = pick(loops);
  const ask = pick(asks);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    part
      ? text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by))
      : text.replaceAll(new RegExp(`^ *${hole}\n`, "gm"), "");
  const valued = (text: string) => text.replaceAll(/\bV\b/g, value[1]);
  const asking = ask[1].replaceAll(/\bO\b/g, "o");
  const body = within(within(loop[1], "MAKE", `const o = ${met[1]};`), "ADD", added[4]).replaceAll("ASK", asking);
  const classes = valued(
    within(within(above[1], "ABOVE", added[1]), "METHODS", added[3].replaceAll("\n  ", "\n")) +
      "\n" +
      within(below[1], "BELOW", added[2]),
  );
  const uses = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    classes,
    ...(uses(/\bput\(/) ? [valued("function put(o, x) {\n  o.z = V;\n}")] : []),
    ...(uses(/\bask\(/) ? ["function ask(o) {\n  return o.z;\n}"] : []),
    ...(uses(/\bkey\b/) ? ["let key = 'z';"] : []),
    ...(uses(/\bclasses\b/) ? ["const classes = [A, B, C];"] : []),
    ...(uses(/\blast\b/) ? ["let last = { z: -1, a: -1, c: -1 };"] : []),
    "const out = [];",
    'const said = v => (typeof v === "function" ? "function" : String(v));',
    `function run(n) {\n${indent(body, "  ")}\n}`,
    "for (const n of [2, 5]) {",
    "  try {",
    "    run(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${above[0]}--${below[0]}--${added[0]}--${value[0]}--${met[0]}--${ask[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(8, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
