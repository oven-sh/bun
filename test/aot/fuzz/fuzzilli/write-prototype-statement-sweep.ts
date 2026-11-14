// Parents that statements name: how a child gets its parent, times what the parent has, times what the child writes over it, times where the statements stand, times what is asked, times what changes later.
//
//   bun write-prototype-statement-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<parent>--<member>--<own>--<place>--<use>--<change>.mjs
//   bun write-prototype-statement-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `Child` and `Base` are constructors.
const parents: [name: string, text: string, before?: string][] = [
  ["create", "Child.prototype = Object.create(Base.prototype);"],
  ["create-constructor", "Child.prototype = Object.create(Base.prototype);\nChild.prototype.constructor = Child;"],
  [
    "create-described",
    "Child.prototype = Object.create(Base.prototype, { constructor: { value: Child, writable: true, configurable: true } });",
  ],
  ["new-parent", "Child.prototype = new Base(0);"],
  ["new-parent-constructor", "Child.prototype = new Base(0);\nChild.prototype.constructor = Child;"],
  ["set-prototype", "Object.setPrototypeOf(Child.prototype, Base.prototype);"],
  ["set-both", "Object.setPrototypeOf(Child.prototype, Base.prototype);\nObject.setPrototypeOf(Child, Base);"],
  ["underscore", "Child.prototype.__proto__ = Base.prototype;"],
  ["inherits", "inherits(Child, Base);", 'import { inherits } from "node:util";'],
  [
    "extends-helper",
    "extendsParent(Child, Base);",
    "const extendsParent = (d, b) => {\n  Object.setPrototypeOf(d, b);\n  function Step() {\n    this.constructor = d;\n  }\n  d.prototype = ((Step.prototype = b.prototype), new Step());\n};",
  ],
  [
    "loose-helper",
    "inheritsLoose(Child, Base);",
    "function inheritsLoose(child, parent) {\n  child.prototype = Object.create(parent.prototype);\n  child.prototype.constructor = child;\n  child.__proto__ = parent;\n}",
  ],
  ["shared", "Child.prototype = Base.prototype;"],
  ["literal", "Child.prototype = { __proto__: Base.prototype, constructor: Child };"],
  ["assigned", "Object.assign(Child.prototype, Base.prototype);"],
  ["define", 'Object.defineProperty(Child, "prototype", { value: Object.create(Base.prototype) });'],
  ["parent-in-a-variable", "const parent = Base;\nChild.prototype = Object.create(parent.prototype);"],
  ["prototype-in-a-variable", "const prototype = Base.prototype;\nChild.prototype = Object.create(prototype);"],
  [
    "chosen-parent",
    "const parent = notes.length > 50 ? Object : Base;\nObject.setPrototypeOf(Child.prototype, parent.prototype);",
  ],
  [
    "by-path",
    "const space = { Base, Child };\nspace.Child.prototype = Object.create(space.Base.prototype);\nspace.Child.prototype.constructor = space.Child;",
  ],
  ["by-path-new", "const space = { inner: { Base, Child } };\nspace.inner.Child.prototype = new space.inner.Base(0);"],
  ["prototype-kept", "const own = (Child.prototype = Object.create(Base.prototype));\nown.kept = true;"],
  [
    "literal-with-accessors",
    "Child.prototype = { __proto__: Base.prototype, get v2() {\n  return this.v * 3;\n}, set v2(value) {\n  this.v = value;\n} };",
  ],
  ["none", ""],
];
// Members of `Base.prototype`.
const members: [name: string, text: string][] = [
  ["function", 'Base.prototype.ask = function () {\n  return "base" + this.v;\n};'],
  ["arrow", 'Base.prototype.ask = () => "arrow";'],
  [
    "getter",
    'Object.defineProperty(Base.prototype, "ask", { configurable: true, get() {\n  return () => "getter" + this.v;\n} });',
  ],
  ["assign", "Object.assign(Base.prototype, { ask() {\n  return this.v * 2;\n} });"],
  ["literal", "Base.prototype = { ask() {\n  return this.v + 1;\n}, w: 3 };"],
  ["value", "Base.prototype.ask = other => other ?? 1;\nBase.prototype.w = 4;"],
  [
    "two",
    'Base.prototype.first = function () {\n  return this.ask();\n};\nBase.prototype.ask = function () {\n  return "two" + this.v;\n};',
  ],
  ["by-name", 'for (const name of ["ask", "tell"]) Base.prototype[name] = function () {\n  return name + this.v;\n};'],
  [
    "literal-with-accessors",
    "Base.prototype = {\n  get ask() {\n    return () => this.v * 4;\n  },\n  set w(value) {\n    this.v = value;\n  },\n};",
  ],
  [
    "accessor-pair",
    "Object.defineProperties(Base.prototype, { ask: { configurable: true, value() {\n  return this.half;\n} }, half: { configurable: true, get() {\n  return this.v / 2;\n}, set(value) {\n  this.v = value * 2;\n} } });",
  ],
];
const owns: [name: string, text: string][] = [
  ["nothing", ""],
  ["own-method", 'Child.prototype.ask = function () {\n  return "child" + this.v;\n};'],
  [
    "calls-parent",
    "const parentAsk = Base.prototype.ask;\nChild.prototype.ask = function () {\n  return [parentAsk.call(this), 1];\n};",
  ],
  ["asks-by-prototype", "Child.prototype.ask = function () {\n  return [Base.prototype.ask.call(this), 2];\n};"],
  ["other-method", "Child.prototype.more = function () {\n  return this.ask() + 1;\n};"],
  ["getter", 'Object.defineProperty(Child.prototype, "v2", { configurable: true, get() {\n  return this.v * 2;\n} });'],
  ["field", "Child.prototype.v = 9;"],
  ["static", "Child.ask = () => 5;\nBase.tell = () => 6;"],
];
// `STATEMENTS` name the parent, `OWN` writes the child's members.
const places: [name: string, text: string][] = [
  ["in-order", "STATEMENTS\nOWN"],
  ["own-first", "OWN\nSTATEMENTS"],
  ["in-a-function", "function prepare() {\n  STATEMENTS\n  OWN\n}\nprepare();"],
  ["in-a-condition", "if (notes.length === 0) {\n  STATEMENTS\n}\nOWN"],
  [
    "behind-an-instance",
    "const early = new Child(8);\nSTATEMENTS\nOWN\nnotes.push(typeof early.ask, early instanceof Base);",
  ],
  ["in-a-loop", "for (const parent of [Base]) {\n  if (parent === Base) {\n    STATEMENTS\n  }\n}\nOWN"],
  ["called-at-once", "(function () {\n  STATEMENTS\n  OWN\n})();"],
];
// `one` is an instance of the child, `two` of the other child, `base` of the parent.
const uses: [name: string, text: string][] = [
  ["calls", "for (const each of [one, two, base, one]) note(() => each.ask());"],
  ["one-by-one", "note(() => one.ask());\nnote(() => two.ask());\nnote(() => base.ask());"],
  [
    "loop",
    'note(() => {\n  let text = "";\n  for (let i = 0; i < 5; i++) text += one.ask?.() + ",";\n  return text;\n});',
  ],
  [
    "instances",
    "note(() => [one instanceof Child, one instanceof Base, two instanceof Child, base instanceof Child, Child.prototype instanceof Base]);",
  ],
  ["constructors", "note(() => [one.constructor === Child, one.constructor === Base, two.constructor.name]);"],
  ["names", "note(() => {\n  const names = [];\n  for (const name in one) names.push(name);\n  return names;\n});"],
  [
    "own",
    'note(() => [Object.hasOwn(one, "ask"), "ask" in one, Object.hasOwn(Child.prototype, "ask"), Object.keys(one).join()]);',
  ],
  [
    "prototypes",
    "note(() => [Object.getPrototypeOf(one) === Child.prototype, Object.getPrototypeOf(Child.prototype) === Base.prototype, Object.getPrototypeOf(Child) === Base]);",
  ],
  ["mapped", "note(() => [1, 2, 3].map(v => new Child(v)).map(each => each.ask()));"],
  ["fields", "note(() => [one.v, one.w, two.v, base.w, one.missing]);"],
  ["passed", "const ask = each => each.ask();\nnote(() => ask(one));\nnote(() => ask(two));\nnote(() => ask(base));"],
  ["statics", "note(() => [typeof Child.ask, typeof Child.tell, Child.name]);"],
  ["others", "note(() => one.more?.());\nnote(() => one.v2);\nnote(() => one.first?.());"],
  [
    "writes",
    'for (const name of ["w", "half", "v2"]) note(() => (one[name] = name.length));\nnote(() => (one.half = 3));\nnote(() => [one.v, one.w, one.half, one.v2, Object.keys(one).join()]);',
  ],
  [
    "writes-in-a-loop",
    "note(() => {\n  let sum = 0;\n  for (let i = 0; i < 4; i++) {\n    one.half = i;\n    one.v2 = (one.v2 ?? 0) + i;\n    sum += one.v;\n  }\n  return sum;\n});",
  ],
];
const changes: [name: string, text: string][] = [
  ["nothing", ""],
  ["parent-method", 'Base.prototype.ask = function () {\n  return "new" + this.v;\n};'],
  ["child-method", 'Child.prototype.ask = function () {\n  return "late" + this.v;\n};'],
  ["deleted", "delete Child.prototype.ask;\ndelete Base.prototype.ask;"],
  ["own-method", 'one.ask = () => "own";'],
  ["instance-parent", "Object.setPrototypeOf(one, Base.prototype);"],
  ["prototype-replaced", "Child.prototype = { ask: () => 77 };"],
  ["parent-of-parent", "Object.setPrototypeOf(Base.prototype, { ask: () => 88, deep: 1 });"],
  ["field", "Base.prototype.w = 12;\nChild.prototype.missing = 13;"],
];
const children: [name: string, text: string][] = [
  ["function", "function Child(v) {\n  this.v = v;\n}"],
  ["calls-parent", "function Child(v) {\n  Base.call(this, v);\n  this.x = 1;\n}"],
  ["empty", "function Child() {}"],
  ["class", "class Child {\n  constructor(v) {\n    this.v = v;\n  }\n}"],
  ["variable", "const Child = function (v) {\n  this.v = v;\n};"],
  ["applies-parent", "function Child() {\n  return Base.apply(this, arguments) || this;\n}"],
];
const total =
  parents.length * members.length * owns.length * places.length * uses.length * changes.length * children.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const parent = pick(parents);
  const member = pick(members);
  const own = pick(owns);
  const place = pick(places);
  const use = pick(uses);
  const change = pick(changes);
  const child = pick(children);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const lines = [
    ...(parent[2]?.startsWith("import") ? [parent[2]] : []),
    "const notes = [];",
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "object" : String(value));',
    "const note = ask => {\n  try {\n    notes.push(show(ask()));\n  } catch (error) {\n    notes.push(error.name);\n  }\n};",
    ...(parent[2] && !parent[2].startsWith("import") ? [parent[2]] : []),
    "function Base(v) {\n  this.v = v;\n}",
    member[1],
    child[1],
    "function Second(v) {\n  this.v = v;\n  this.second = true;\n}",
    "Second.prototype = Object.create(Base.prototype);",
    "try {",
    indent(place[1].replace("STATEMENTS", () => parent[1]).replace("OWN", () => own[1]), "  ").split("\n").filter(line => line.trim()).join("\n"),
    "} catch (error) {",
    "  notes.push(error.name);",
    "}",
    "const one = new Child(1);",
    "const two = new Second(2);",
    "const base = new Base(3);",
    "{",
    indent(use[1], "  "),
    "}",
    ...(change[1] ? ["try {", indent(change[1], "  "), "} catch (error) {", "  notes.push(error.name);", "}", "{", indent(use[1], "  "), "}"] : []),
    'console.log(notes.join(" "));',
  ]; // prettier-ignore
  return {
    name: `${parent[0]}--${member[0]}--${own[0]}--${place[0]}--${use[0]}--${change[0]}.mjs`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
