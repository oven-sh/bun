// A function is given an object and stores a name on it that the object's class or literal does not spell, as frameworks do
// with a request: `request.parsedUrl = ..`. The compiler may give such a late name a place in the objects of the one or two
// classes it saw arrive there. Each scene picks which objects really arrive (of one class, of several, a subclass, an object
// without a class, a frozen one, a proxy), what the name collides with (a method, an accessor, an inherited value, a private
// name's public twin, nothing) and how the name is looked at afterwards, on objects that got it and on objects that did not.
import type { Random } from "./random";

/** Names to store. Some are members of the classes below. */
const names = [
  "late",
  "late",
  "parsed",
  "norm",
  "size",
  "kind",
  "both",
  "both",
  "inherited",
  "x",
  "constructor",
  "toString",
  "0",
  "__late",
];

/** Expressions for an object that is handed to the function. */
const givens = [
  "new Point(1, 2)",
  "new Point(1, 2)",
  "new Other()",
  "new Below(1, 2)",
  "{ x: 1, y: 2 }",
  "{ y: 2, x: 1, z: 3 }",
  "Object.create(Point.prototype)",
  "Object.create(null)",
  "Object.freeze(new Point(1, 2))",
  "Object.preventExtensions(new Point(1, 2))",
  "Object.seal(new Other())",
  "new Proxy(new Point(1, 2), {})",
  "new Proxy(new Point(1, 2), { set: () => true })",
  "[1, 2]",
  "function () {}",
  "new Map()",
];

/** Statements that store NAME on `given`. */
const stores = [
  "given.NAME = value;",
  "given.NAME = value;",
  'given["NAME"] = value;',
  'given[key("NAME")] = value;',
  "given.NAME ??= value;",
  "Object.assign(given, { NAME: value });",
  'Object.defineProperty(given, "NAME", { value, writable: true, enumerable: true, configurable: true });',
  'Object.defineProperty(given, "NAME", { get: () => value, configurable: true });',
  "if (value !== 2) given.NAME = value;",
  "given.NAME = value;\n  given.second = value + 1;",
  'Reflect.set(given, "NAME", value);',
  // A descriptor without a value, a getter or a setter still makes an own property, which holds undefined.
  'Object.defineProperty(given, "NAME", { enumerable: false });',
  'Object.defineProperty(given, "NAME", {});',
  'if (value === 2) Object.defineProperty(given, "NAME", { enumerable: true });\n  else given.NAME = value;',
  'given.NAME = value;\n  Object.defineProperty(given, "NAME", { configurable: true });',
];

/** Expressions about `it`, an object that may or may not have got the name. */
const looks = [
  "it.NAME",
  "typeof it.NAME",
  '"NAME" in it',
  'Object.hasOwn(it, "NAME")',
  "Object.keys(it).join()",
  "JSON.stringify(it)",
  "it.norm?.()",
  "it.size",
  "({ ...it }).NAME",
  "(delete it.NAME, it.NAME)",
  'Object.getOwnPropertyDescriptor(it, "NAME")?.enumerable',
  "read(it)",
  "String(it.NAME)",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const name = random.pick(names);
    const named = (text: string) =>
      /^\d/.test(name)
        ? text.replaceAll(".NAME", `[${name}]`).replaceAll("?[", "?.[").replaceAll("NAME", name)
        : text.replaceAll("NAME", name);
    const usual = random.pick(givens.slice(0, 6));
    const strangers = random.sample(givens, random.between(1, 3));
    const asked = random.sample(looks, random.between(2, 4)).map(named);
    const warm = random.pick([0, 1, 300, 3000]);
    scenes.push(`function mark${scene}(given, value) {
  ${named(random.pick(stores))}
  return given;
}
function look${scene}(it) {
  return [${asked.map(look => `told(() => ${look})`).join(", ")}].map(String).join(",");
}
{
  ${warm ? `for (let i = 0; i < ${warm}; i++) told(() => look${scene}(mark${scene}(${usual}, i)));` : ""}
  console.log("scene ${scene} usual", told(() => look${scene}(mark${scene}(${usual}, 1))), "| without", told(() => look${scene}(${usual})));
  ${strangers.map(stranger => `console.log("scene ${scene}", told(() => look${scene}(mark${scene}(${stranger}, 2))), "| without", told(() => look${scene}(${stranger})));`).join("\n  ")}
  console.log("scene ${scene} usual again", told(() => look${scene}(mark${scene}(${usual}, 3))));
}`);
  }
  return `const key = name => process.argv[9] ?? name;
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  norm() {
    return this.x + this.y;
  }
  get size() {
    return 2;
  }
  set kind(value) {
    this.x = value;
  }
  get both() {
    return this.y;
  }
  set both(value) {
    this.y = value;
  }
}
Point.prototype.inherited = "from the prototype";
class Below extends Point {
  z = 3;
}
class Other {
  a = 1;
  norm() {
    return "other";
  }
}
const read = it => it.late ?? it.parsed ?? "neither";
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
