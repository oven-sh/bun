// `const v = Object.create(proto); v.x = 1; v.sum()`, with proto a module variable stored once. A compiler may leave such an object
// unmade and keep its link to the prototype as a field, as long as every call reads that one variable. Each scene varies what that
// rests on: the variable is stored again, the prototype takes a setter, a read-only field or a getter, or changes its own link, the
// program asks for the link by getPrototypeOf, instanceof or a for-in, and the object escapes on one turn in many.
import type { Random } from "./random";

const protos = [
  "{ base: 1, sum() { return this.x + this.base; } }",
  "{ base: 1, sum() { return this.x + this.base; } }",
  "{ base: 1, sum() { return this.x + this.base; } }",
  "{ base: 2, x: 9, sum() { return this.x + this.base; } }",
  "{ base: 3, get x() { return 40; }, sum() { return this.x + this.base; } }",
  "{ base: 3, set x(value) { this.seen = value; }, sum() { return this.seen + this.base; } }",
  "Object.freeze({ base: 4, x: 5, sum() { return this.x + this.base; } })",
  'Object.defineProperty({ base: 5, sum() { return this.x + this.base; } }, "x", { value: 7, writable: false })',
  "Object.create({ base: 6, sum() { return this.x + this.base; } })",
  "Keeper.prototype",
  "Array.prototype",
  "new Proxy({ base: 7, sum() { return this.x + this.base; } }, { get(target, key, receiver) { return key === 'base' ? 70 : Reflect.get(target, key, receiver); } })",
];

const strangeProtos = ["null", "undefined", "1", '"text"'];

const lateStores = [
  "held = { base: 100, sum() { return this.x * 2; } };",
  "held = null;",
  "held = Object.create(held);",
  "held.base = 50;",
  "held.sum = function () { return -1; };",
  "held.x = 11;",
  "delete held.base;",
  "Object.setPrototypeOf(held, { late: 1 });",
  'Object.defineProperty(held, "x", { get() { return 12; }, configurable: true });',
  "Object.freeze(held);",
];

const asks = [
  "v.sum()",
  "v.sum()",
  "v.x",
  "v.base",
  "v.late",
  "Object.getPrototypeOf(v) === held",
  "Object.getPrototypeOf(v) === first",
  "held.isPrototypeOf(v)",
  "first.isPrototypeOf(v)",
  "v instanceof Keeper",
  '"base" in v',
  '"x" in v',
  'Object.hasOwn(v, "x")',
  "Object.keys(v).join()",
  "JSON.stringify(v)",
  "namesIn(v)",
  "Object.getOwnPropertyNames(v).length",
  "typeof v.sum",
  "v.__proto__ === held",
  "Reflect.getPrototypeOf(v) === first",
  "Object.isExtensible(v)",
  "({ ...v }).x",
  "Object.getPrototypeOf(Object.getPrototypeOf(v)) === Object.prototype",
];

const stores = [
  "v.x = i;",
  "v.x = i;",
  "v.x = i;",
  "v.x = i; v.y = i + 1;",
  "v.x = i + 0.5;",
  "v.x = String(i);",
  "",
  "v.base = i; v.x = 1;",
];

const escapes = [
  "kept = v;",
  "kept.push(v);",
  "handOn(v);",
  "Object.setPrototypeOf(v, { x: 8 });",
  "v.__proto__ = { base: 9 };",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = typed ? "(held as any)" : "held";
  const failure = typed ? "(error as Error).name" : "error.name";
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.35);
    const proto = isPlain ? protos[0]! : !random.chance(0.1) ? random.pick(protos) : random.pick(strangeProtos);
    const lateStore = isPlain || proto === "Array.prototype" || random.chance(0.45) ? "" : random.pick(lateStores);
    const store = isPlain ? "v.x = i;" : random.pick(stores);
    const escape = isPlain || random.chance(0.5) ? "" : random.pick(escapes);
    const typedText = (code: string) =>
      typed
        ? code
            .replaceAll("sum() {", "sum(this: any): any {")
            .replaceAll("function () {", "function (this: any) {")
            .replaceAll("set x(value)", "set x(value: any)")
            .replaceAll("this.seen = value", "(this as any).seen = value")
        : code;
    const asked = random.sample(asks, isPlain ? 1 : random.between(1, 4));
    const turns = random.pick([6, 60, 400, 3000]);
    const at = random.below(Math.min(turns, 30));
    const seldom = random.pick([1, 3, 17]);
    const isAnother = !isPlain && random.chance(0.2);
    const name = (code: string) => code.replace(/\bheld\b/g, `held${scene}`).replace(/\bfirst\b/g, `first${scene}`);
    const late = name(typedText(lateStore).replace(/\bheld\.|\(held\)|held,/g, each => each.replace("held", any)));
    scenes.push(`let held${scene}${as("any")} = ${typedText(proto)};
const first${scene}${as("any")} = held${scene};
function make${scene}(i${as("number")}) {
  const v${as("any")} = Object.create(held${scene});
  ${store}
  ${escape ? `if (i % ${seldom} === 0) { ${escape} }` : ""}
  return [${asked.map(ask => `String(${name(ask)})`).join(", ")}].join(" ");
}
${isAnother ? `function other${scene}(i${as("number")}) {\n  const v${as("any")} = Object.create(held${scene});\n  v.x = -i;\n  return v.x;\n}` : ""}
{
  let hash = 0;
  let last = "";
  for (let i = 0; i < ${turns}; i++) {
    ${late ? `if (i === ${at}) {\n      try {\n        ${late}\n      } catch (error) {\n        last = ${failure};\n      }\n    }` : ""}
    try {
      last = make${scene}(i)${isAnother ? ` + other${scene}(i)` : ""};
    } catch (error) {
      last = "threw " + ${failure};
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `class Keeper {}
let kept${as("any")} = [];
function handOn(given${as("any")}) {
  kept = given;
}
function namesIn(given${as("any")}) {
  const names = [];
  for (const name in given) names.push(name);
  return names.join();
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
