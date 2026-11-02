// An object is born with closures in its fields: arrow functions as class fields, stores in a constructor, members of a
// literal in a factory. The compiler may leave such a closure unmade until somebody reads the field. Each scene makes one
// or many objects and then looks at the fields in several of the ways the language has: a call, a read by a known or an
// unknown name, a pattern, a copy, a listing, a descriptor, a comparison, a delete, a store, with collections in between.
// A closure must be the same object at every read, another one for every object, and see its own object's state.
import type { Random } from "./random";

/** Declarations of `makeN(x)`, which returns an object with the number `x` and the closures `f` and `g`. */
const makers = [
  'class KN {\n  f = () => this.x + 1;\n  g = () => "g";\n  constructor(x) {\n    this.x = x;\n  }\n}\nconst makeN = x => new KN(x);',
  'class KN {\n  constructor(x) {\n    this.x = x;\n    this.f = () => this.x + 1;\n    this.g = function () {\n      return "g";\n    };\n  }\n}\nconst makeN = x => new KN(x);',
  "class KN {\n  x = 0;\n  f = () => this.x + 1;\n  g = () => this.f() + 1;\n}\nconst makeN = x => Object.assign(new KN(), { x });",
  'function makeN(x) {\n  const it = { x, f: () => it.x + 1, g: () => "g" };\n  return it;\n}',
  'function makeN(x) {\n  return { x, f: () => x + 1, g: () => "g" };\n}',
  "function makeN(x) {\n  return {\n    x,\n    f: () => x + 1,\n    g() {\n      return this.f() + 1;\n    },\n  };\n}",
  'function KN(x) {\n  this.x = x;\n  this.f = () => this.x + 1;\n  this.g = () => "g";\n}\nconst makeN = x => new KN(x);',
  'class BaseN {\n  f = () => this.x + 1;\n}\nclass KN extends BaseN {\n  g = () => "g";\n  constructor(x) {\n    super();\n    this.x = x;\n  }\n}\nconst makeN = x => new KN(x);',
  'function makeN(x) {\n  const it = { x };\n  it.f = () => it.x + 1;\n  it.g = () => "g";\n  return it;\n}',
];

/** Expressions about the object `it` and another object `other` of the same maker. */
const looks = [
  "it.f()",
  "it.g()",
  "it.f === it.f",
  "it.f === other.f",
  "it.f() + other.f()",
  'it[key("f")]()',
  'it[key("f")] === it.f',
  "(({ f }) => f())(it)",
  "(({ f, ...rest }) => Object.keys(rest).join() + f())(it)",
  "({ ...it }).f === it.f",
  "({ ...it }).f()",
  "Object.assign({}, it).f === it.f",
  'Object.values(it).filter(value => typeof value === "function").length',
  'Object.entries(it).map(([name, value]) => name + " " + typeof value).join()',
  "JSON.stringify(it)",
  'typeof Object.getOwnPropertyDescriptor(it, "f").value',
  'Object.getOwnPropertyDescriptor(it, "f").value === it.f',
  "Object.getOwnPropertyDescriptors(it).g.value === it.g",
  'it.f.name + " " + it.f.length',
  '((it.f.tag = "tag"), it.f.tag + other.f.tag)',
  "readers[it.x % readers.length](it)",
  "(seen.set(it.f, it.x), seen.get(it.f) + String(seen.has(other.f)))",
  "(delete it.f, typeof it.f + typeof other.f)",
  '((it.f = () => "new"), it.f() + other.f())',
  "((it.x = 50), it.f())",
  "(Object.freeze(it), it.f())",
  "structuredClone(it)",
  'Bun.inspect(it).includes("Function")',
  'Reflect.get(it, "f")()',
  "it.f.call(null)",
  "it.f.bind(other)()",
  'Reflect.ownKeys(it).join() + ("f" in it) + Object.hasOwn(it, "g")',
  "[it].map(each => each.f)[0] === it.f",
  '(() => {\n    let kinds = "";\n    for (const name in it) kinds += name + typeof it[name];\n    return kinds;\n  })()',
  "(Bun.gc(true), it.f())",
  "(Bun.gc(true), it.f === it.f)",
  "new it.g()",
  "it.f instanceof Function",
  "Object.getPrototypeOf(it.f) === Function.prototype",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const count = random.pick([2, 2, 3, 300, 3000]);
    const picked = random.sample(looks, random.between(2, 6));
    const which = random.pick(["0", "1", `${count - 1}`]);
    scenes.push(`${random.pick(makers).replaceAll("N", String(scene))}
{
  const all = [];
  for (let x = 0; x < ${count}; x++) all.push(make${scene}(x));
  ${random.pick(["", "", "Bun.gc(true);", `for (const each of all) each.x += 0;`, `for (const each of all) each.g();`])}
  const it = all[${which}];
  const other = all[${which === "0" ? "1" : "0"}];
  ${picked.map(look => `console.log("scene ${scene}", told(() => ${look}));`).join("\n  ")}
  console.log("scene ${scene} ends", told(() => all.filter(each => typeof each.f === "function").length), told(() => new Set(all.map(each => each.f)).size), told(() => all.at(-1).f()));
}`);
  }
  return `const key = name => process.argv[9] ?? name;
const seen = new WeakMap();
const readers = [it => it.f(), it => typeof it.f, it => it.g() + it.f()];
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
