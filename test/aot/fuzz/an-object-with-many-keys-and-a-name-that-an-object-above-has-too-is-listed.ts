// A table, no seeds: an object with many keys has a name that an object above it has too, and its keys are listed in every way: each name once, in the order of the language.
//
//   how the object is made x how the name is held at the levels of the chain x how many keys x index keys, names or both x JavaScript | TypeScript
//
// One case to a program. The counts stand on both sides of twenty: a listing goes from a search to a set there.
type Made = { name: string; text: (isTyped: boolean) => string; hasItsOwnElements?: true };

const bag = (isTyped: boolean) => (isTyped ? ": Bag" : "");
const asBag = (isTyped: boolean) => (isTyped ? " as unknown as Bag" : "");

/** `P` is the object above, `N` the number of keys. Each declares `o`. */
const makers: readonly Made[] = [
  { name: "a literal", text: t => `const o${bag(t)} = { __proto__: P, first: 1 };` },
  { name: "an instance", text: t => `class C { first = 1; }\nObject.setPrototypeOf(C.prototype, P);\nconst o${bag(t)} = new C()${asBag(t)};` }, // prettier-ignore
  { name: "Object.create", text: t => `const o${bag(t)} = Object.create(P);` },
  { name: "a list", text: t => `const o${bag(t)} = []${asBag(t)};\nObject.setPrototypeOf(o, P);` },
  { name: "a typed array", text: t => `const o${bag(t)} = new Uint8Array(N)${asBag(t)};\nObject.setPrototypeOf(o, P);`, hasItsOwnElements: true }, // prettier-ignore
  { name: "arguments", text: t => `const o${bag(t)} = (function () { return arguments; })()${asBag(t)};\nObject.setPrototypeOf(o, P);` }, // prettier-ignore
  {
    name: "a proxy",
    text: t => `const target${bag(t)} = Object.create(P);\nconst o${bag(t)} = new Proxy(target, {});`,
  },
  { name: "below a proxy", text: t => `const o${bag(t)} = Object.create(new Proxy(P, {}));` },
  { name: "a function", text: t => `const o${bag(t)} = function () {}${asBag(t)};\nObject.setPrototypeOf(o, P);` },
  { name: "a constructor function", text: t => `function F(${t ? "this: Bag" : ""}) { this.first = 1; }\nF.prototype = P;\nconst o${bag(t)} = new (F${t ? " as unknown as new () => Bag" : ""})();` }, // prettier-ignore
];

const hidden = (value: number) => `{ value: ${value}, enumerable: false, configurable: true, writable: true }`;
/** `above` is the object above, `stores` puts the name on the object. Where `isFirst`, ahead of the other keys. */
const holds: readonly { name: string; above: string; stores: string; isFirst?: true }[] = [
  { name: "its own alone", above: "{ other: 1 }", stores: "o.b = 1;" },
  { name: "inherited alone", above: "{ b: 7, other: 1 }", stores: "" },
  { name: "its own over an inherited one", above: "{ b: 7, other: 1 }", stores: "o.b = null;" },
  {
    name: "its own over an inherited one, stored first",
    above: "{ b: 7, other: 1 }",
    stores: "o.b = null;",
    isFirst: true,
  },
  {
    name: "hidden over enumerable",
    above: "{ b: 7, other: 1 }",
    stores: `Object.defineProperty(o, "b", ${hidden(1)});`,
  },
  {
    name: "enumerable over hidden",
    above: `Object.defineProperty({ other: 1 }, "b", ${hidden(7)})`,
    stores: "o.b = 1;",
  },
  { name: "an accessor over data", above: "{ b: 7, other: 1 }", stores: 'Object.defineProperty(o, "b", { get() { return 3; }, enumerable: true, configurable: true });' }, // prettier-ignore
  { name: "many keys above as well", above: "fill({ b: 7, other: 1 }, 30)", stores: "o.b = null;" },
  { name: "nineteen keys above", above: "fill({ b: 7 }, 19)", stores: "o.b = null;" },
  {
    name: "a symbol too",
    above: '{ b: 7, [Symbol.for("s")]: 1, other: 1 }',
    stores: 'o.b = null; o[Symbol.for("s")] = 2;',
  },
  { name: "removed and stored again", above: "{ b: 7, other: 1 }", stores: "o.b = 1; o.c = 2; delete o.b; o.b = 3;" },
  {
    name: "at three levels",
    above: "Object.setPrototypeOf({ b: 7, other: 1 }, { b: 9, deep: 1 })",
    stores: "o.b = null;",
  },
  { name: "at three levels, hidden in the middle", above: `Object.setPrototypeOf(Object.defineProperty({ other: 1 }, "b", ${hidden(7)}), { b: 9, deep: 1 })`, stores: "o.b = null;" }, // prettier-ignore
  {
    name: "above and above that alone",
    above: "Object.setPrototypeOf({ b: 7, other: 1 }, { b: 9, deep: 1 })",
    stores: "",
  },
];

const counts = [0, 1, 18, 19, 20, 21, 22, 64, 1000];

/** What `fill` stores under at the turn `i`. */
const keys = [
  { name: "index keys", text: "i" },
  { name: "names", text: '"k" + i' },
  { name: "index keys and names in turns", text: 'i % 2 ? i : "k" + i' },
];

const crossed = makers.flatMap(makes =>
  holds.flatMap(held =>
    counts.flatMap(count =>
      keys
        .filter(key => !makes.hasItsOwnElements || key.name === "index keys")
        .flatMap(key => [false, true].map(isTyped => ({ makes, held, count, key, isTyped }))),
    ),
  ),
);

export const programs = crossed.length;

export function programOf(index: number): { file: string; text: string } {
  // Neighbors in the table differ in the language alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { makes, held, count, key, isTyped: t } = crossed[(index * 7919) % crossed.length];
  const fills = makes.hasItsOwnElements ? "" : "fill(o, N);";
  const list = t ? ": string[]" : "";
  return {
    file: t ? "main.ts" : "main.js",
    text: `${t ? "type Bag = Record<string | symbol, unknown>;\n" : ""}console.log(${JSON.stringify(`${makes.name} | ${held.name} | ${count} | ${key.name}`)});
const N = ${count};
function fill(object${bag(t)}, count${t ? ": number" : ""}) { for (let i = 0; i < count; i++) object[${key.text}] = i; return object; }
function digest(keys${t ? ": (string | symbol)[]" : ""}) {
  let indexes = 0, sum = 0; const names${list} = [];
  for (const key of keys) { if (typeof key === "string" && String(+key) === key) { indexes++; sum = (sum * 31 + +key) % 1000003; } else names.push(String(key)); }
  return indexes + "/" + sum + "/" + names.length + "/" + names.slice(0, 4).join(",") + ".." + names.slice(-6).join(",");
}
const P${bag(t)} = ${held.above};
${makes.text(t)}
${held.isFirst ? held.stores + "\n" + fills : fills + "\n" + held.stores}
const walked${list} = [];
for (const key in o) walked.push(key);
console.log("for-in", digest(walked), new Set(walked).size === walked.length);
const again${list} = [];
for (const key in o) again.push(key);
console.log("again", digest(again));
console.log("keys", digest(Object.keys(o)));
console.log("names", digest(Object.getOwnPropertyNames(o)));
console.log("ownKeys", digest(Reflect.ownKeys(o)));
console.log("entries", Object.entries(o).length, "values", Object.values(o).length);
const json = JSON.stringify(o) ?? "undefined";
console.log("json", json.length, json.slice(-40));
console.log("spread", digest(Reflect.ownKeys({ ...o })));
console.log("assign", digest(Reflect.ownKeys(Object.assign({}, o))));
console.log("assign over", digest(Reflect.ownKeys(Object.assign({ b: 0, z: 1 }, o))));
const { b, ...rest } = o;
console.log("rest", String(b), digest(Reflect.ownKeys(rest)));
const text = new Function("o", "let s = []; for (const k in o) s.push(k); return s;")(o);
console.log("text", digest(text));
const below${bag(t)} = Object.create(o); below.other = 5; below[3] = 1;
const under${list} = [];
for (const key in below) under.push(key);
console.log("below", digest(under), new Set(under).size === under.length);
${t ? "export {};\n" : ""}`,
  };
}
