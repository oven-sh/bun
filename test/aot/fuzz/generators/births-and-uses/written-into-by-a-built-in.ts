// An object that the program has had for long is handed to a built-in that writes into it: as what a species constructor answers, as the receiver of a method of arrays, as a target.
// Every such object against every such road. Functions that have run often look at the object before and behind: its keys one by one, a table read by its keys, its fields by name, its length and its elements.
type Kind = "number" | "object" | "text";
type Victim = { make: string; before?: string; fields?: Record<string, Kind>; elements?: Kind };

const victims: Record<string, Victim> = {
  literal: { make: `{ la: { qb: 3 }, lb: 4 }`, fields: { la: "object", lb: "number" } },
  literalWithALength: { make: `{ la: { qb: 3 }, lb: 4, length: 0 }`, fields: { la: "object", lb: "number", length: "number" } },
  literalWithALongLength: { make: `{ la: { qb: 3 }, lb: 4, length: 3 }`, fields: { la: "object", lb: "number", length: "number" } },
  literalWhoseLengthIsAText: { make: `{ la: { qb: 3 }, lb: 4, length: "text" }`, fields: { la: "object", lb: "number", length: "text" } },
  literalWhoseLengthIsAFraction: { make: `{ la: { qb: 3 }, lb: 4, length: 1.5 }`, fields: { la: "object", lb: "number", length: "number" } },
  literalWithElements: { make: `{ 0: 10, 1: 11, la: { qb: 3 }, lb: 4, length: 2 }`, fields: { la: "object", lb: "number", length: "number" } },
  literalWithASetterOfLength: { make: `{ la: { qb: 3 }, lb: 4, set length(value: unknown) { said.push("length is given " + String(value)); }, get length(): unknown { return 1; } }`, fields: { la: "object", lb: "number" } },
  literalWithASetterOfAnElement: { make: `{ la: { qb: 3 }, lb: 4, set 0(value: unknown) { said.push("0 is given " + String(value)); } }`, fields: { la: "object", lb: "number" } },
  literalBelowSetters: {
    make: `Object.setPrototypeOf({ la: { qb: 3 }, lb: 4 }, { set length(value: unknown) { said.push("length is given " + String(value)); }, set 0(value: unknown) { said.push("0 is given " + String(value)); } }) as { la: { qb: number }; lb: number }`,
    fields: { la: "object", lb: "number" },
  },
  literalBelowNothing: { make: `Object.assign(Object.create(null) as { la: { qb: number }; lb: number }, { la: { qb: 3 }, lb: 4 })`, fields: { la: "object", lb: "number" } },
  frozenLiteral: { make: `Object.freeze({ la: { qb: 3 }, lb: 4 })`, fields: { la: "object", lb: "number" } },
  sealedLiteral: { make: `Object.seal({ la: { qb: 3 }, lb: 4, length: 0 })`, fields: { la: "object", lb: "number", length: "number" } },
  literalThatTakesNoMore: { make: `Object.preventExtensions({ la: { qb: 3 }, lb: 4 })`, fields: { la: "object", lb: "number" } },
  literalWithAFieldThatIsOnlyRead: { make: `Object.defineProperty({ la: { qb: 3 }, lb: 4 }, "lb", { writable: false })`, fields: { la: "object", lb: "number" } },
  instance: { before: `class A { la = { qb: 3 }; lb = 4; }`, make: `new A()`, fields: { la: "object", lb: "number" } },
  instanceWithALength: { before: `class A { la = { qb: 3 }; lb = 4; length = 0; }`, make: `new A()`, fields: { la: "object", lb: "number", length: "number" } },
  instanceWithASetterOfLength: { before: `class A { la = { qb: 3 }; lb = 4; set length(value: unknown) { said.push("length is given " + String(value)); } }`, make: `new A()`, fields: { la: "object", lb: "number" } },
  instanceOfAnHeir: { before: `class Above { la = { qb: 3 }; length = 0; }\nclass A extends Above { lb = 4; }`, make: `new A()`, fields: { la: "object", lb: "number", length: "number" } },
  wholeNumbers: { make: `[1, 2, 3, 4]`, elements: "number" },
  fractions: { make: `[1.5, 2.5, 3.5]`, elements: "number" },
  objects: { make: `[{ qb: 5 }, { qb: 6 }, { qb: 7 }]`, elements: "object" },
  texts: { make: `["a", "bc", "def"]`, elements: "text" },
  emptyList: { make: `[] as number[]`, elements: "number" },
  listWithAHole: { make: `[1, , 3] as number[]`, elements: "number" },
  frozenList: { make: `Object.freeze([1, 2, 3]) as number[]`, elements: "number" },
  listWithAName: { make: `Object.assign([1, 2, 3], { la: { qb: 3 }, lb: 4 })`, fields: { la: "object", lb: "number" }, elements: "number" },
  bytes: { make: `new Uint8Array([1, 2, 3, 4])`, elements: "number" },
  aFunction: { make: `Object.assign(function () {}, { la: { qb: 3 }, lb: 4 })`, fields: { la: "object", lb: "number" } },
  aMap: { make: `Object.assign(new Map<string, number>(), { la: { qb: 3 }, lb: 4 })`, fields: { la: "object", lb: "number" } },
};

const answering = `function () { return victim; }`;
const bySpecies = (source: string, call: string) => `const source: any = ${source}; source.constructor = { [Symbol.species]: ${answering} }; return source.${call};`;
const asReceiver = (method: string, ...given: string[]) => `return (Array.prototype.${method} as Function).call(${["victim", ...given].join(", ")});`;

/** The body of a function that hands `victim` to the built-in. */
const roads: Record<string, string> = {
  sliceBySpecies: bySpecies(`["s", "t"]`, "slice(0)"),
  sliceOfNothingBySpecies: bySpecies(`["s", "t"]`, "slice(2)"),
  sliceOfNumbersBySpecies: bySpecies(`[7, 8]`, "slice(0)"),
  spliceBySpecies: bySpecies(`["s", "t", "u"]`, "splice(0, 2)"),
  concatBySpecies: bySpecies(`["s"]`, `concat(["t"], "u")`),
  mapBySpecies: bySpecies(`["s", "t"]`, "map((each: unknown) => each)"),
  mapToObjectsBySpecies: bySpecies(`[1, 2]`, "map((each: number) => ({ qb: each }))"),
  filterBySpecies: bySpecies(`["s", "t"]`, "filter(() => true)"),
  flatBySpecies: bySpecies(`[["s"], "t"]`, "flat()"),
  flatMapBySpecies: bySpecies(`["s", "t"]`, "flatMap((each: unknown) => [each])"),
  arrayFrom: `return (Array.from as Function).call(${answering}, ["s", "t"]);`,
  arrayFromWhatHasALength: `return (Array.from as Function).call(${answering}, { length: 2, 0: "s", 1: "t" });`,
  arrayOf: `return (Array.of as Function).call(${answering}, "s", "t");`,
  push: asReceiver("push", `"s"`, `"t"`),
  pushOfNothing: asReceiver("push"),
  pop: asReceiver("pop"),
  shift: asReceiver("shift"),
  unshift: asReceiver("unshift", `"s"`),
  fill: asReceiver("fill", `"f"`),
  copyWithin: asReceiver("copyWithin", "0", "1"),
  reverse: asReceiver("reverse"),
  sort: asReceiver("sort"),
  splice: asReceiver("splice", "0", "1", `"s"`, `"t"`),
  assign: `return Object.assign(victim, { la: "text", lb: { qb: 9 }, length: "long", 0: "zero", nw: 1 });`,
  assignOfTheSameKinds: `return Object.assign(victim, { la: { qb: 8 }, lb: 5 });`,
  define: `return Object.defineProperty(victim, "la", { value: "text", writable: true, enumerable: true, configurable: true });`,
  defineAGetter: `return Object.defineProperty(victim, "lb", { get() { return "got"; }, enumerable: true, configurable: true });`,
  defineSeveral: `return Object.defineProperties(victim, { nw: { value: 1, enumerable: true }, length: { value: "long", writable: true, enumerable: true, configurable: true } });`,
  hide: `return Object.defineProperty(victim, "la", { enumerable: false });`,
  reflectSet: `return [Reflect.set(victim, "la", "text"), Reflect.set(victim, "nw", 1), Reflect.set(victim, "length", "long")];`,
  reflectSetForAnother: `return Reflect.set({ set la(value: unknown) { (this as any).nw = value; } }, "la", "text", victim);`,
  reflectDefine: `return Reflect.defineProperty(victim, "nw", { value: 1, enumerable: true });`,
  reflectDelete: `return [Reflect.deleteProperty(victim, "la"), Reflect.deleteProperty(victim, "length")];`,
  anotherPrototype: `return Object.setPrototypeOf(victim, { la: "above", nw: "above", 5: "above" });`,
  freeze: `return Object.freeze(victim);`,
  fieldsOfAnHeir: `return new (class extends (${answering} as any) { la = "text"; nw = 1; })();`,
  lastIndexOfASplit: `const pattern: any = /,/; pattern.constructor = { [Symbol.species]: function () { return Object.assign(victim, { exec: () => null }); } }; return "a,b".split(pattern);`,
  lastIndexOfAMatch: `return (RegExp.prototype as any)[Symbol.match].call(Object.assign(victim, { exec: () => null, flags: "g" }), "text");`,
};

const read: Record<Kind, (place: string) => string> = { number: place => `${place} + 1`, object: place => `${place}.qb`, text: place => `${place}.length` };

export const oneIn = 3;

export function programs(typed = false) {
  const made: { name: string; file: string; text: string }[] = [];
  for (const [victimName, victim] of Object.entries(victims))
    for (const [roadName, road] of Object.entries(roads)) {
      const fields = Object.entries(victim.fields ?? {});
      const text = () => `const said: string[] = [];
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).constructor.name; } }
${victim.before ?? ""}
const victim = ${victim.make};
type Victim = typeof victim;
function keysOneByOne(v: Victim): string { let la = 0, lb = 0, length = 0, others = ""; for (const key of Object.keys(v)) { if (key === "la") la++; else if (key === "lb") lb++; else if (key === "length") length++; else others += "+" + key; } return [la, lb, length, others].join(); }
function keysInALoop(v: Victim): string { let text = ""; for (const key in v) text += key === "la" || key === "lb" ? "." : key + ";"; return text; }
function tableByKeys(v: Victim): string { const table: Record<string, number> = { la: 1, lb: 2 }; return Object.keys(v).map(key => table[key]).join(); }
function ownNames(v: Victim): string { return Reflect.ownKeys(v).filter(name => name !== "la" && name !== "lb").map(String).join("+"); }
function values(v: Victim): string { return Object.values(v).map(each => typeof each).join(); }
function copied(v: Victim): string { return Object.keys({ ...v }).join("+"); }
function written(v: Victim): string { return JSON.stringify(v) ?? "nothing"; }
function asked(v: Victim): string { return ["la" in v, "nw" in v, "length" in v, 0 in v, Object.hasOwn(v, "length"), Object.hasOwn(v, 0)].join(); }
${fields.map(([name, kind]) => `function ${name}OfIt(v: Victim): string { return typeof v.${name} + " " + attempt(() => ${read[kind](`v.${name}`)}); }`).join("\n")}
${victim.elements ? `function elements(v: Victim): string { let text = v.length + ":"; for (let at = 0; at < v.length; at++) text += attempt(() => ${read[victim.elements]("v[at]")}) + ","; return text; }` : `function elements(v: Victim): string { const any: any = v; return typeof any.length + " " + String(any.length) + " " + String(any[0]) + " " + String(any[1]); }`}
function looks(v: Victim): string {
  return [${["keysOneByOne", "keysInALoop", "tableByKeys", "ownNames", "values", "copied", "written", "asked", ...fields.map(([name]) => name + "OfIt"), "elements"].map(look => `"${look} " + attempt(() => ${look}(v))`).join(", ")}].join("\\n");
}
function road(): unknown { ${road} }
let before = "";
for (let turn = 0; turn < 60; turn++) before = looks(victim);
console.log(before);
console.log("road", attempt(() => { const answer = road(); return answer === victim ? "the object" : Array.isArray(answer) ? "[" + answer.join() + "]" : typeof answer; }));
console.log(looks(victim));
console.log("said", said.join("; "));
export {};
`;
      made.push({
        name: `${victimName}-${roadName}`,
        file: typed ? "program.ts" : "program.mjs",
        get text() {
          return typed ? text() : new Bun.Transpiler({ loader: "ts" }).transformSync(text());
        },
      });
    }
  return made;
}
