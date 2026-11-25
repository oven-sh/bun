// Members of classes: how a member comes to be, times how a class below changes it, times how it is used in a loop, times where the object comes from. Initializers, getters, setters and calls note that they ran.
//
//   bun write-class-member-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<member>--<heir>--<use>--<object>.mjs
//   bun write-class-member-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// What the class `Base` holds: text in its body, text at the end of its constructor, text behind the class.
const members: [name: string, body: string, inConstructor: string, behind: string][] = [
  ["field", "m = made(1);", "", ""],
  ["empty-field", "m;", "", ""],
  ["field-of-field", "m = this.n + 1;", "", ""],
  ["field-of-given", "m = [this.n, 2];", "", ""],
  ["arrow-field", "m = by => this.n + by;", "", ""],
  ["method", "m(by) {\n  return this.n + by;\n}", "", ""],
  ["method-that-changes", "m(by) {\n  this.n += by;\n  return this;\n}", "", ""],
  ["getter", 'get m() {\n  notes.push("get");\n  return this.n;\n}', "", ""],
  [
    "accessors",
    'get m() {\n  return this.n * 2;\n}\nset m(value) {\n  notes.push("set");\n  this.n = value;\n}',
    "",
    "",
  ],
  ["setter", 'set m(value) {\n  notes.push("set");\n  this.n = value;\n}', "", ""],
  ["private-field", "#m = 4;\nget m() {\n  return this.#m;\n}\nset m(value) {\n  this.#m = value;\n}", "", ""],
  ["private-method", "#m(by) {\n  return this.n - by;\n}\nm(by) {\n  return this.#m(by);\n}", "", ""],
  ["computed", '[key("m")] = made(2);', "", ""],
  ["computed-method", '[key("m")](by) {\n  return by;\n}', "", ""],
  ["async-method", "async m(by) {\n  return this.n + by;\n}", "", ""],
  ["generator-method", "*m(by) {\n  yield this.n;\n  yield by;\n}", "", ""],
  ["assigned", "", "this.m = given + 10;", ""],
  ["assigned-sometimes", "", "if (given > 1) this.m = given;", ""],
  ["assigned-twice", "m = 1;", 'this.m = "t" + given;', ""],
  ["defined", "", 'Object.defineProperty(this, "m", { value: given, enumerable: given > 1 });', ""],
  ["on-prototype", "", "", "Base.prototype.m = 12;"],
  ["method-on-prototype", "", "", "Base.prototype.m = function (by) {\n  return [this.n, by];\n};"],
  ["static-beside", "static m = 5;\nm = Base.m + 1;", "", ""],
  ["static-block", "static {\n  this.prototype.m = this.name;\n}", "", ""],
  ["none", "", "", ""],
];
// The class that the objects are of; `C` is its name.
const heirs: [name: string, text: string][] = [
  ["itself", "const C = Base;"],
  ["heir", "class C extends Base {}"],
  ["heir-field", "class C extends Base {\n  m = made(7);\n}"],
  ["heir-empty-field", "class C extends Base {\n  m;\n}"],
  ["heir-method", "class C extends Base {\n  m(by) {\n    return by + 1;\n  }\n}"],
  ["heir-super-method", 'class C extends Base {\n  m(by) {\n    notes.push("up");\n    return super.m(by);\n  }\n}'],
  [
    "heir-super-read",
    "class C extends Base {\n  get m() {\n    return super.m;\n  }\n  set m(value) {\n    super.m = value;\n  }\n}",
  ],
  ["heir-getter", 'class C extends Base {\n  get m() {\n    return "heir" + this.n;\n  }\n}'],
  [
    "heir-sets-behind",
    "class C extends Base {\n  constructor(given) {\n    super(given);\n    this.m = given * 3;\n  }\n}",
  ],
  ["heir-more-fields", "class C extends Base {\n  z = 1;\n  y = this.m;\n  n = 8;\n}"],
  [
    "heir-other-object",
    "class C extends Base {\n  constructor(given) {\n    super(given);\n    return given === 2 ? { n: 2, m: 3 } : this;\n  }\n}",
  ],
  [
    "mixin",
    "const mix = Above => class extends Above {\n  w = 6;\n  m2() {\n    return this.m;\n  }\n};\nclass C extends mix(Base) {}",
  ],
  [
    "function-below",
    "function C(given) {\n  return Reflect.construct(Base, [given], new.target);\n}\nC.prototype = Object.create(Base.prototype, { constructor: { value: C } });",
  ],
  ["two-below", "class Middle extends Base {\n  o = 2;\n}\nclass C extends Middle {\n  o = 3;\n}"],
  [
    "patched-below",
    "class C extends Base {}\ntry {\n  C.prototype.m = 20;\n} catch (error) {\n  notes.push(told(error));\n}",
  ],
];
// `OBJ` is the object, `k` the counter.
const uses: [name: string, text: string][] = [
  ["read", "note(OBJ.m);"],
  ["read-twice", "note([OBJ.m, OBJ.n, OBJ.m]);"],
  ["sum", "sum += OBJ.m | 0;"],
  ["call", "note(OBJ.m(k));"],
  ["call-once-known", 'if (typeof OBJ.m === "function") note(OBJ.m(k));\nelse note(OBJ.m);'],
  ["optional-call", "note(OBJ.m?.(k));"],
  ["store", "OBJ.m = k;\nnote(OBJ.m);"],
  ["add", "OBJ.m += k;\nnote(OBJ.m);"],
  ["step", "note(OBJ.m++);"],
  ["nullish-store", "OBJ.m ??= k;\nnote(OBJ.m);"],
  ["delete", "note(delete OBJ.m);\nnote(OBJ.m);"],
  ["in", 'note(["m" in OBJ, Object.hasOwn(OBJ, "m")]);'],
  ["keys", "note(Object.keys(OBJ));"],
  ["for-in", "for (const name in OBJ) notes.push(name);"],
  ["spread", "note({ ...OBJ });"],
  ["text", "note(JSON.stringify(OBJ));"],
  ["destructured", "const { m, n, ...others } = OBJ;\nnote([m, n, others]);"],
  ["default", 'const { m = made("d") } = OBJ;\nnote(m);'],
  ["by-name", 'note(OBJ[k & 1 ? "m" : "n"]);'],
  ["by-key", "note(OBJ[names[k]]);"],
  ["store-by-key", "OBJ[names[k]] = k;\nnote(OBJ[names[k]]);"],
  [
    "borrowed",
    'const borrowed = OBJ.m;\nnote(typeof borrowed === "function" ? borrowed.call({ n: 50 }, k) : borrowed);',
  ],
  ["alone", 'const alone = OBJ.m;\nnote(typeof alone === "function" ? alone(k) : alone);'],
  ["bound", 'const bound = OBJ.m;\nif (typeof bound === "function") note(bound.bind(OBJ, 3)(k));'],
  ["descriptor", 'const found = Object.getOwnPropertyDescriptor(OBJ, "m");\nnote(found ? Object.keys(found) : found);'],
  ["redefined", 'Object.defineProperty(OBJ, "m", { value: k, configurable: true, writable: false });\nnote(OBJ.m);'],
  ["frozen", "Object.freeze(OBJ);\nOBJ.m = 9;\nnote(OBJ.m);"],
  ["assigned-from", "note(Object.assign(new C(5), OBJ));"],
  ["assigned-to", "note(Object.assign(OBJ, { m: k, q: 1 }));"],
  ["prototype-changed", "if (k === 2) C.prototype.m = 33;\nnote(OBJ.m);"],
  [
    "method-replaced",
    'if (k === 1) Base.prototype.m = () => "new";\nnote(typeof OBJ.m === "function" ? OBJ.m(k) : OBJ.m);',
  ],
  ["prototype-of-object", "if (k === 2) Object.setPrototypeOf(OBJ, { m: 70 });\nnote(OBJ.m);"],
  ["class-of", "note([OBJ instanceof C, OBJ.constructor === C, OBJ.constructor.name]);"],
  ["reflect", 'note([Reflect.get(OBJ, "m", { n: 60 }), Reflect.set(OBJ, "m", k), Reflect.has(OBJ, "m")]);'],
  ["compared", "note([OBJ.m === OBJ.m, OBJ.m > k, OBJ.m == null]);"],
  ["stored-elsewhere", "const row = { m: OBJ.m, k };\nnote(row);"],
];
// `USE` is the use; the object is called by `OBJ`.
const objects: [name: string, text: string, object: string][] = [
  ["new", "for (let k = 0; k < 4; k++) {\n  const o = new C(k);\nUSE\n}", "o"],
  ["one", "const o = new C(1);\nfor (let k = 0; k < 4; k++) {\nUSE\n}", "o"],
  [
    "list",
    "const list = [new C(1), new Base(2), new C(3), { n: 4, m: 1.5 }];\nfor (let k = 0; k < list.length; k++) {\nUSE\n}",
    "list[k]",
  ],
  [
    "element",
    "const list = [new C(1), new Base(2), new C(0)];\nlet k = 0;\nfor (const o of list) {\nUSE\n  k++;\n}",
    "o",
  ],
  [
    "field",
    "const holder = { o: new C(2), k: 0 };\nfor (let k = 0; k < 4; k++) {\nUSE\n  if (k === 1) holder.o = new Base(3);\n}",
    "holder.o",
  ],
  [
    "parameter",
    "const turn = (o, k) => {\nUSE\n};\nfor (let k = 0; k < 4; k++) turn(k & 1 ? new C(k) : new Base(k), k);",
    "o",
  ],
  [
    "captured",
    "const runs = [];\nfor (let k = 0; k < 4; k++) {\n  const o = new C(k);\n  runs.push(() => {\nUSE\n  });\n}\nfor (const run of runs) run();",
    "o",
  ],
  ["class-of-two", "for (let k = 0; k < 4; k++) {\n  const o = new [C, Base][k & 1](k);\nUSE\n}", "o"],
  [
    "own-method",
    "Base.prototype.run = function (k) {\nUSE\n};\nconst o = new C(2);\nfor (let k = 0; k < 4; k++) o.run(k);",
    "this",
  ],
  [
    "parsed",
    "for (let k = 0; k < 4; k++) {\n  const o = Object.assign(Object.create(C.prototype), JSON.parse('{\"n\":3}'));\nUSE\n}",
    "o",
  ],
];
const total = members.length * heirs.length * uses.length * objects.length * 2;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const member = pick(members);
  const heir = pick(heirs);
  const use = pick(uses);
  const object = pick(objects);
  const isCaughtInside = rest % 2 === 0;
  const indent = (text: string, by: string) => text.split("\n").filter(line => line).map(line => by + line); // prettier-ignore
  const used = use[1].replaceAll(/\bOBJ\b/g, () => object[2]);
  const turn = isCaughtInside ? `try {\n${used}\n} catch (error) {\n  notes.push(told(error));\n}` : used;
  const lines = [
    "const notes = [];",
    "let sum = 0;",
    'const told = error => "!" + error.name;',
    'const show = value => (value instanceof Promise ? "promise" : typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : typeof value + " " + String(value));',
    "const note = value => void notes.push(show(value));",
    "const made = value => (notes.push(\"made\"), value);",
    "const key = name => (notes.push(\"key\"), name);",
    'const names = JSON.parse(\'["n","m","none","m"]\');',
    "class Base {",
    "  n = 0;",
    ...indent(member[1], "  "),
    "  constructor(given) {",
    "    this.n = given;",
    ...indent(member[2], "    "),
    "  }",
    "}",
    ...indent(member[3], ""),
    ...indent(heir[1], ""),
    "function walk() {",
    ...indent(object[1].replace("USE", () => indent(turn, "    ").join("\n")), "  "),
    "}",
    "for (let round = 0; round < 2; round++) {",
    "  try {",
    "    walk();",
    "  } catch (error) {",
    '    notes.push("left" + told(error));',
    "  }",
    "}",
    'console.log(notes.join(" "), sum);',
  ]; // prettier-ignore
  return { name: `${member[0]}--${heir[0]}--${use[0]}--${object[0]}.mjs`, text: lines.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
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
