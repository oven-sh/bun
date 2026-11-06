// A table, no seeds: an object arrives by a road that says nothing of it and is walked, and between two reads of one place the walk reads a member of the object, which runs code that stores to that place.
//
//   how the object is made x what the code stores to x how the object arrives x at the top level | in a function x JavaScript | TypeScript
//
// One case to a program. Each program walks in fourteen ways, each way four times: over a new object of the case and over a parsed one in turns, so that one piece of code meets both.
const bag = (isTyped: boolean) => (isTyped ? ": Bag" : "");
const asBag = (isTyped: boolean) => (isTyped ? " as unknown as Bag" : "");

/** Each declares `made`. `E` is the statement that stores. */
const makers: readonly { name: string; text: (isTyped: boolean) => string; trapsItsOwnFields?: true }[] = [
  { name: "only values", text: t => `const made${bag(t)} = { first: 1, middle: "text", last: 2 };` },
  { name: "a getter in the middle", text: t => `const made${bag(t)} = { first: 1, get counted() { E return "counted"; }, last: 2 };` }, // prettier-ignore
  { name: "a getter first", text: t => `const made${bag(t)} = { get counted() { E return "counted"; }, middle: 1, last: 2 };` }, // prettier-ignore
  { name: "a getter last", text: t => `const made${bag(t)} = { first: 1, last: 2, get counted() { E return "counted"; } };` }, // prettier-ignore
  { name: "two getters", text: t => `const made${bag(t)} = { get one() { E return 1; }, last: 2, get two() { E E return 2; } };` }, // prettier-ignore
  { name: "a setter alone", text: t => `const made${bag(t)} = { first: 1, set counted(value${t ? ": unknown" : ""}) { E }, last: 2 };` }, // prettier-ignore
  { name: "a getter defined over a field", text: t => `const made${bag(t)} = { first: 1, counted: 0, last: 2 };\n  Object.defineProperty(made, "counted", { get() { E return "defined"; }, enumerable: true, configurable: true });` }, // prettier-ignore
  { name: "a getter defined under a new name", text: t => `const made${bag(t)} = { first: 1, last: 2 };\n  Object.defineProperty(made, "counted", { get() { E return "defined"; }, enumerable: true, configurable: true });` }, // prettier-ignore
  { name: "a hidden getter beside values", text: t => `const made${bag(t)} = { first: 1, last: 2 };\n  Object.defineProperty(made, "counted", { get() { E return "hidden"; }, enumerable: false, configurable: true });` }, // prettier-ignore
  { name: "an instance with an accessor of its own", text: t => `class Made { first = 1; last = 2; }\n  const made${bag(t)} = new Made()${asBag(t)};\n  Object.defineProperty(made, "counted", { get() { E return "own"; }, enumerable: true, configurable: true });` }, // prettier-ignore
  { name: "below a literal with a getter", text: t => `const made${bag(t)} = Object.create({ first: 1, get counted() { E return "inherited"; } });\n  made.last = 2;` }, // prettier-ignore
  { name: "parsed, with a getter", text: t => `const made${bag(t)} = JSON.parse('{"first":1,"last":2}');\n  Object.defineProperty(made, "counted", { get() { E return "parsed"; }, enumerable: true, configurable: true });` }, // prettier-ignore
  { name: "filled by key, with a getter", text: t => `const made${bag(t)} = {};\n  for (const key of ["first", "last"]) made[key] = key.length;\n  Object.defineProperty(made, "counted", { get() { E return "by key"; }, enumerable: true, configurable: true });` }, // prettier-ignore
  { name: "a getter that becomes a value", text: t => `const made${bag(t)} = { first: 1, get counted() { E Object.defineProperty(made, "counted", { value: "a value", enumerable: true }); return "a getter"; }, last: 2 };` }, // prettier-ignore
  { name: "a getter that removes the next name", text: t => `const made${bag(t)} = { first: 1, get counted() { E delete made.next; return "removed"; }, next: 3, last: 2 };` }, // prettier-ignore
  { name: "a getter that adds a name", text: t => `const made${bag(t)} = { first: 1, get counted() { E made.added = 3; return "added"; }, last: 2 };` }, // prettier-ignore
  { name: "a proxy whose get trap stores", text: t => `const made${bag(t)} = new Proxy({ first: 1, last: 2 }${asBag(t)}, { get(target, key) { E return Reflect.get(target, key); } });`, trapsItsOwnFields: true }, // prettier-ignore
  { name: "a proxy whose every trap stores", text: t => `const made${bag(t)} = new Proxy({ first: 1, last: 2 }${asBag(t)}, {\n    get(target, key) { E return Reflect.get(target, key); },\n    has(target, key) { E return Reflect.has(target, key); },\n    ownKeys(target) { E return Reflect.ownKeys(target); },\n    getOwnPropertyDescriptor(target, key) { E return Reflect.getOwnPropertyDescriptor(target, key); },\n  });`, trapsItsOwnFields: true }, // prettier-ignore
  { name: "below a proxy", text: t => `const made${bag(t)} = Object.create(new Proxy({ above: 1 }${asBag(t)}, { get(target, key) { E return Reflect.get(target, key); }, has(target, key) { E return Reflect.has(target, key); } }));\n  made.first = 1;\n  made.last = 2;` }, // prettier-ignore
  { name: "a list with a getter under an index", text: t => `const made${bag(t)} = [1, 2, 3]${asBag(t)};\n  Object.defineProperty(made, "1", { get() { E return "element"; }, enumerable: true, configurable: true });\n  made.last = 2;` }, // prettier-ignore
  { name: "a function with a getter", text: t => `const made${bag(t)} = function () {}${asBag(t)};\n  made.first = 1;\n  Object.defineProperty(made, "counted", { get() { E return "of a function"; }, enumerable: true, configurable: true });\n  made.last = 2;` }, // prettier-ignore
  { name: "a value with a method that converts it", text: t => `const made${bag(t)} = { first: 1, counted: { toString() { E return "converted"; }, toJSON() { E return "written"; } }, last: 2 };` }, // prettier-ignore
];

/** `stores` is `E`, `reads` the place that the walk reads on both sides. */
const places: readonly { name: string; stores: string; reads: string; isOfWalkedObject?: true }[] = [
  { name: "a field of another object", stores: "state.n++;", reads: "state.n" },
  { name: "a variable of the file", stores: "count++;", reads: "count" },
  { name: "a field of the walked object", stores: "made.last++;", reads: "made.last", isOfWalkedObject: true },
  { name: "an element of a list", stores: "list[0]++;", reads: "list[0]" },
  { name: "the length of a list", stores: "list.push(0);", reads: "list.length" },
  { name: "an entry of a map", stores: 'map.set("n", (map.get("n") ?? 0) + 1);', reads: 'map.get("n")' },
  { name: "an element of a typed array", stores: "bytes[0]++;", reads: "bytes[0]" },
];

const arrivals: readonly { name: string; text: (isTyped: boolean) => string }[] = [
  { name: "as it is", text: () => "object" },
  { name: "out of a trap", text: t => `new Proxy({}${asBag(t)}, { get: () => object }).anything` },
  { name: "out of a reviver", text: () => 'JSON.parse("[0]", () => object)' },
  { name: "out of a map", text: t => `new Map([["key", object]]).get("key")${t ? "!" : ""}` },
  { name: "out of text made at run time", text: () => 'new Function("object", "return object")(object)' },
];

/** `R` is the place. Each adds to `line`. */
const walks: readonly { name: string; text: string }[] = [
  { name: "for-in", text: "for (const key in walked) { const before = R; const value = walked[key]; line += ` ${key}:${before}>${R}=${value}`; }" }, // prettier-ignore
  { name: "for-in, Reflect.get", text: "for (const key in walked) { const before = R; const value = Reflect.get(walked, key); line += ` ${key}:${before}>${R}=${value}`; }" }, // prettier-ignore
  { name: "for-in, in", text: "for (const key in walked) { const before = R; const has = key in walked; line += ` ${key}:${before}>${R}=${has}`; }" }, // prettier-ignore
  { name: "for-in, hasOwn", text: "for (const key in walked) { const before = R; const has = Object.hasOwn(walked, key); line += ` ${key}:${before}>${R}=${has}`; }" }, // prettier-ignore
  { name: "for-in, twice", text: "for (const key in walked) { const before = R; const value = walked[key]; const between = R; const again = walked[key]; line += ` ${key}:${before}>${between}>${R}=${value},${again}`; }" }, // prettier-ignore
  { name: "keys by index", text: "const keys = Object.keys(walked); for (let i = 0; i < keys.length; i++) { const before = R; const value = walked[keys[i]]; line += ` ${keys[i]}:${before}>${R}=${value}`; }" }, // prettier-ignore
  { name: "keys, for-of", text: "for (const key of Object.keys(walked)) { const before = R; const value = walked[key]; line += ` ${key}:${before}>${R}=${value}`; }" }, // prettier-ignore
  { name: "keys, forEach", text: "Object.keys(walked).forEach(key => { const before = R; const value = walked[key]; line += ` ${key}:${before}>${R}=${value}`; });" }, // prettier-ignore
  { name: "entries", text: "{ const before = R; const entries = Object.entries(walked); line += ` ${before}>${R}`; for (const [key, value] of entries) line += ` ${key}=${value}`; }" }, // prettier-ignore
  { name: "values", text: "{ const before = R; const values = Object.values(walked); line += ` ${before}>${R}=${values.join()}`; }" }, // prettier-ignore
  { name: "a spread", text: "{ const before = R; const copy = { ...walked }; line += ` ${before}>${R}=${Object.keys(copy).join()}`; }" }, // prettier-ignore
  { name: "Object.assign", text: "{ const before = R; const copy = Object.assign({}, walked); line += ` ${before}>${R}=${Object.keys(copy).join()}`; }" }, // prettier-ignore
  { name: "a rest pattern", text: "{ const before = R; const { first, ...rest } = walked; line += ` ${before}>${R}=${first},${Object.keys(rest).join()}`; }" }, // prettier-ignore
  { name: "JSON", text: "{ const before = R; const text = JSON.stringify(walked); line += ` ${before}>${R}=${text}`; }" }, // prettier-ignore
];

const crossed = makers.flatMap(makes =>
  places
    .filter(place => !(makes.trapsItsOwnFields && place.isOfWalkedObject))
    .flatMap(place =>
      arrivals.flatMap(arrival =>
        [false, true].flatMap(isInFunction =>
          [false, true].map(isTyped => ({ makes, place, arrival, isInFunction, isTyped })),
        ),
      ),
    ),
);

export const programs = crossed.length;

// Neighbors in the table differ in the language alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
const caseAt = (index: number) => crossed[(index * 7919) % crossed.length];

export function nameOf(index: number): string {
  const { makes, place, arrival, isInFunction, isTyped } = caseAt(index);
  return `${makes.name} | ${place.name} | ${arrival.name} | ${isInFunction ? "in a function" : "at the top level"} | ${isTyped ? "TypeScript" : "JavaScript"}`;
}

export function programOf(index: number): { file: string; text: string } {
  const { makes, place, arrival, isInFunction, isTyped: t } = caseAt(index);
  const body = (walk: { text: string }) => walk.text.replace(/\bR\b/g, place.reads);
  return {
    file: t ? "main.ts" : "main.js",
    text: `${t ? "type Bag = Record<string, any>;\n" : ""}console.log(${JSON.stringify(nameOf(index))});
const state = { n: 0 };
let count = 0;
const list = [0];
const map = new Map${t ? "<string, number>" : ""}([["n", 0]]);
const bytes = new Uint8Array(1);
function make()${bag(t)} {
  ${makes.text(t).replace(/\bE\b/g, place.stores)}
  return made;
}
function parse()${bag(t)} {
  return JSON.parse('{"first":1,"middle":"text","last":2}');
}
function arrive(object${bag(t)})${bag(t)} {
  return ${arrival.text(t)};
}
${walks
  .map((walk, number) =>
    isInFunction
      ? `function walk${number}(walked${bag(t)}, made${bag(t)}) {\n  let line = "";\n  ${body(walk)}\n  return line;\n}\nfor (let round = 0; round < 4; round++) {\n  const made = round % 2 ? parse() : make();\n  console.log(${JSON.stringify(walk.name)}, round, walk${number}(arrive(made), made));\n}`
      : `for (let round = 0; round < 4; round++) {\n  const made = round % 2 ? parse() : make();\n  const walked = arrive(made);\n  let line = "";\n  ${body(walk)}\n  console.log(${JSON.stringify(walk.name)}, round, line);\n}`,
  )
  .join("\n")}
${t ? "export {};\n" : ""}`,
  };
}
