// The least programs that read through getters: the getter, times the object it is asked of, times what changes, times the read, times the loop, with nothing beside.
//
//   bun write-bare-getter-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<getter>--<object>--<change>--<read>--<loop>.mjs, .cjs or .ts
//   bun write-bare-getter-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The class is C; its getter is `g`, its field `f`.
const getters: [name: string, text: string][] = [
  ["field", "class C {\n  constructor(f) {\n    this.f = f;\n  }\n  get g() {\n    return this.f;\n  }\n}"],
  [
    "class-field",
    "class C {\n  f = 7;\n  constructor(f) {\n    if (f) this.f = f;\n  }\n  get g() {\n    return this.f;\n  }\n}",
  ],
  [
    "private",
    "class C {\n  #f;\n  constructor(f) {\n    this.#f = f;\n    this.f = f;\n  }\n  get g() {\n    return this.#f;\n  }\n}",
  ],
  [
    "underscore",
    "class C {\n  constructor(f) {\n    this._g = f;\n    this.f = f;\n  }\n  get g() {\n    return this._g;\n  }\n  set g(value) {\n    this._g = value;\n  }\n}",
  ],
  [
    "above",
    "class A {\n  get g() {\n    return this.f;\n  }\n}\nclass C extends A {\n  constructor(f) {\n    super();\n    this.f = f;\n  }\n}",
  ],
  [
    "of-field-above",
    "class A {\n  constructor(f) {\n    this.f = f;\n  }\n}\nclass C extends A {\n  get g() {\n    return this.f;\n  }\n}",
  ],
  ["late-field", "class C {\n  constructor(f) {\n    if (f) this.f = f;\n  }\n  get g() {\n    return this.f;\n  }\n}"],
  [
    "of-two",
    "class C {\n  constructor(f) {\n    this.o = { f };\n    this.f = f;\n  }\n  get g() {\n    return this.o.f;\n  }\n}",
  ],
  ["computed", "class C {\n  constructor(f) {\n    this.f = f;\n  }\n  get g() {\n    return this.f + 1;\n  }\n}"],
  ["constant", "class C {\n  constructor(f) {\n    this.f = f;\n  }\n  get g() {\n    return 5;\n  }\n}"],
  [
    "counts",
    "class C {\n  constructor(f) {\n    this.f = f;\n  }\n  get g() {\n    count++;\n    return this.f;\n  }\n}",
  ],
  ["literal", "const C = function (f) {\n  return {\n    f,\n    get g() {\n      return this.f;\n    },\n  };\n};"],
  [
    "defined",
    "function C(f) {\n  this.f = f;\n}\nObject.defineProperty(C.prototype, 'g', { get() {\n  return this.f;\n}, configurable: true });",
  ],
  [
    "static",
    "class C {\n  static f = 9;\n  static get g() {\n    return this.f;\n  }\n  constructor(f) {\n    this.f = f;\n  }\n}",
  ],
  ["itself", "class C {\n  constructor(f) {\n    this.f = f;\n  }\n  get g() {\n    return this;\n  }\n}"],
];
// `o` is asked.
const objects: [name: string, text: string][] = [
  ["one", "const o = new C(3);"],
  ["fresh", "const o = new C(i);"],
  ["heir", "const o = new (class extends C {})(4);"],
  ["heir-with-field", "const o = new Shadow(4);"],
  ["heir-with-getter", "const o = new Own(4);"],
  ["either", "const o = i & 1 ? new C(1) : new C('t');"],
  ["of-other-class", "const o = i & 1 ? new C(1) : { g: 'own', f: 2 };"],
  ["kept", "const o = kept;"],
  ["created", "const o = Object.create(C.prototype);"],
  ["created-with-field", "const o = Object.assign(Object.create(C.prototype), { f: 8 });"],
  ["class-itself", "const o = C;"],
  ["null", "const o = i === 2 ? null : new C(i);"],
  ["number", "const o = i === 2 ? 5 : new C(i);"],
];
const changes: [name: string, text: string][] = [
  ["nothing", ";"],
  ["field", "o.f = 'changed';"],
  ["field-removed", "delete o.f;"],
  [
    "own-value",
    "Object.defineProperty(o, 'g', { value: 'shadow', configurable: true, writable: true, enumerable: true });",
  ],
  [
    "getter-replaced",
    "if (i === 1) Object.defineProperty(C.prototype, 'g', { get: () => 'new', configurable: true });",
  ],
  ["getter-removed", "if (i === 1) delete C.prototype.g;"],
  [
    "getter-to-value",
    "if (i === 1) Object.defineProperty(C.prototype, 'g', { value: 'value', configurable: true, writable: true });",
  ],
  ["field-getter", "Object.defineProperty(o, 'f', { get: () => 'fg', configurable: true });"],
  ["field-above", "if (i === 1) C.prototype.f = 'above';"],
  ["stored", "try {\n  o.g = 'stored';\n} catch {}"],
  ["parent-changed", "if (i === 1) Object.setPrototypeOf(C.prototype, { f: 'pp', g: 'gg' });"],
  ["own-parent", "if (i === 1) Object.setPrototypeOf(o, { g: 'op' });"],
  ["frozen", "Object.freeze(o);"],
  ["kind", "o.f = i & 1 ? 0.5 : { v: 1 };"],
  ["undefined", "o.f = undefined;"],
  ["assigned", "Object.assign(o, { f: 'as' });"],
  ["stepped", "o.f++;"],
];
const reads: [name: string, text: string][] = [["read", "out.push(show(o.g));"], ["asked", "out.push(show(o?.g));"], ["twice", "out.push(show(o.g) + show(o.g));"], ["sum", "out.push(show(o.g + 1));"], ["by-key", "out.push(show(o['g']));"], ["by-given-key", "out.push(show(o[['g', 'f'][i & 1]]));"], ["destructured", "const { g, f } = o;\nout.push(show(g), show(f));"], ["in", "out.push('g' in o, Object.hasOwn(o, 'g'));"], ["spread", "out.push(Object.keys({ ...o }).join());"], ["helper", "out.push(show(get(o)));"], ["with-field", "out.push(o.g === o.f);"], ["condition", "out.push(o.g ? 'y' : 'n');"], ["called", "out.push(typeof o.g);"], ["after", "const before = o.g;\no.f = 'later';\nout.push(show(before), show(o.g));"]]; // prettier-ignore
const loops: [name: string, text: string][] = [["four", "for (let i = 0; i < 4; i++) {\n  IN\n}"], ["once", "for (let i = 1; i < 2; i++) {\n  IN\n}"], ["many", "for (let i = 0; i < 40; i++) {\n  IN\n}"], ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 3; i++) {\n    IN\n  }\n}"], ["callback", "[0, 1, 2].forEach(i => {\n  IN\n});"]]; // prettier-ignore
const orders: [name: string, text: string][] = [["read-behind", "OBJECT\nCHANGE\nREAD"], ["read-around", "OBJECT\nREAD2\nCHANGE\nREAD"], ["change-behind", "OBJECT\nREAD\nCHANGE"]]; // prettier-ignore
const total = getters.length * objects.length * changes.length * reads.length * loops.length * orders.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const change = pick(changes);
  const getter = pick(getters);
  const read = pick(reads);
  const object = pick(objects);
  const order = pick(orders);
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && change[0] !== "frozen" && change[0] !== "stored";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const turn = within(within(within(within(order[1], "OBJECT", object[1]), "READ2", "out.push(show(o.g));"), "CHANGE", change[1]), "READ", read[1]); // prettier-ignore
  const body = within(loop[1], "IN", `try {\n${indent(turn, "  ")}\n} catch (error) {\n  out.push(error.name);\n}`);
  const uses = (word: RegExp) => word.test(body);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const out = [];",
    "let count = 0;",
    "const show = x => (Object.is(x, -0) ? '-0' : typeof x === 'object' && x ? 'o' : typeof x === 'function' ? 'c' : String(x));",
    getter[1],
    ...(uses(/Shadow/) ? ["class Shadow extends C {\n  g = 'field';\n}"] : []),
    ...(uses(/new Own/) ? ["class Own extends C {\n  get g() {\n    return 'own' + this.f;\n  }\n}"] : []),
    ...(uses(/\bkept\b/) ? ["const kept = new C(6);"] : []),
    ...(uses(/get\(o\)/) ? ["const get = o => o.g;"] : []),
    `function run() {\n${indent(body, "  ")}\n}`,
    "run();",
    "run();",
    "console.log(out.join(' ').slice(0, 900), count);",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${getter[0]}--${object[0]}--${change[0]}--${read[0]}--${order[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
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
