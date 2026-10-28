// The same places in the code see objects of shapes that are made, die in a collection and are made again a little differently: whatever a place remembers about a shape must die with the shape.
//
//   shapes    literals in another order, literals with other keys ahead, classes evaluated again, classes with other fields each time, prototypes made again, constructor functions made again, subclasses and mixins evaluated again,
//             an accessor where a value was, objects with very many keys, frozen objects, objects without a prototype, arrays and functions with properties, prototypes exchanged later, private names of a class evaluated again
//   places    reads, stores, calls of methods, `in`, keys, for-in, spreads, patterns, properties added and deleted, reads from the prototype, reads of what is missing, instanceof, private names, JSON, through `any` and through a declared type
//   between   nothing, a collection, many other shapes made and dropped, both; every generation or every few
//
// Every object comes with what it must answer, so the program checks itself and prints only what is wrong.
import type { Random } from "./random";

const prelude = `declare const Bun: { gc(full: boolean): unknown };
const wrong = new Set<string>();
type Made = { o: any; g: number; kind: string; hasMethod: boolean; inherited: number | undefined; made: any; isFrozen: boolean; keys: string | undefined };
type Pair = { a: number; b: number };
function readA(o: any): unknown {
  return o.a;
}
function readB(o: any): unknown {
  return o.b;
}
function readTyped(o: Pair): number {
  return o.a * 1000 + o.b;
}
function callMethod(o: any): unknown {
  return o.m();
}
function callIfThere(o: any): unknown {
  return o.m?.();
}
function hasA(o: any): boolean {
  return "a" in o;
}
function hasOwnB(o: any): boolean {
  return Object.hasOwn(o, "b");
}
function keysOf(o: any): string {
  return Object.keys(o).join();
}
function walk(o: any): string {
  let all = "";
  for (const key in o) if (Object.hasOwn(o, key)) all += (all ? "," : "") + key;
  return all;
}
function spread(o: any): any {
  return { ...o };
}
function pattern({ a, b }: any): unknown {
  return a * 1000 + b;
}
function store(o: any, value: number): void {
  o.a = value;
}
function storeTyped(o: Pair, value: number): void {
  o.b = value;
}
function addAndDelete(o: any): boolean {
  o.z = 1;
  const had = o.z === 1;
  delete o.z;
  return had && o.z === undefined;
}
function readInherited(o: any): unknown {
  return o.inherited;
}
function readMissing(o: any): unknown {
  return o.missing;
}
function isA(o: any, made: any): boolean {
  return o instanceof made;
}
function text(o: any): string {
  return JSON.stringify(o);
}
function look(made: Made, earlier: Made | undefined): void {
  const { o, g, kind } = made;
  const say = (what: string) => void wrong.add(kind + " " + what);
LOOKS
}
`;

const looks: readonly string[] = [
  `if (readA(o) !== g) say("a");`,
  `if (readB(o) !== g + 1) say("b");`,
  `if (readTyped(o) !== g * 1000 + g + 1) say("a and b through a type");`,
  `if (made.hasMethod && callMethod(o) !== g * 2) say("m()");`,
  `if (callIfThere(o) !== (made.hasMethod ? g * 2 : undefined)) say("m?.()");`,
  `if (!hasA(o)) say("in");`,
  `if (!hasOwnB(o)) say("hasOwn");`,
  `if (made.keys !== undefined && keysOf(o) !== made.keys) say("keys");`,
  `if (made.keys !== undefined && walk(o) !== made.keys) say("for-in");`,
  `{\n    const copy = spread(o);\n    if (copy.a !== g || copy.b !== g + 1) say("a spread");\n  }`,
  `if (pattern(o) !== g * 1000 + g + 1) say("a pattern");`,
  `if (!made.isFrozen && kind !== "an-accessor-or-a-value") {\n    store(o, g + 7);\n    if (readA(o) !== g + 7) say("a store");\n    store(o, g);\n  }`,
  `if (!made.isFrozen) {\n    storeTyped(o, g + 9);\n    if (readB(o) !== g + 9) say("a store through a type");\n    storeTyped(o, g + 1);\n  }`,
  `if (!made.isFrozen && !addAndDelete(o)) say("added and deleted");`,
  `if (readInherited(o) !== made.inherited) say("inherited");`,
  `if (readMissing(o) !== undefined) say("missing");`,
  `if (made.made !== undefined && !isA(o, made.made)) say("instanceof");`,
  `if (made.made !== undefined && earlier !== undefined && earlier.made !== undefined && isA(earlier.o, made.made)) say("instanceof the class of another time");`,
  `if (made.made?.reads !== undefined) {\n    if (made.made.reads(o) !== g) say("a private name");\n    if (earlier !== undefined && made.made.reads(earlier.o) !== -1) say("the private name of another time");\n  }`,
  `if (made.keys !== undefined && kind !== "functions-with-properties" && kind !== "arrays-with-properties" && JSON.parse(text(o)).b !== g + 1) say("JSON");`,
];

// The body of a function of `g` that answers with a Made. `rest` fills in what is the same for most.
const makers: readonly (readonly [name: string, body: string])[] = [
  ["literals-in-another-order", `const o = g % 2 ? { a: g, b: g + 1 } : { b: g + 1, a: g };\n  return { ...rest, o, keys: g % 2 ? "a,b" : "b,a" };`],
  ["literals-with-other-keys-ahead", `const o = { ["p" + (g % 5)]: 0, a: g, b: g + 1 };\n  return { ...rest, o, keys: "p" + (g % 5) + ",a,b" };`],
  ["literals-with-more-keys-each-time", `const o: any = {};\n  for (let n = 0; n < g % 9; n++) o["q" + n] = n;\n  o.a = g;\n  o.b = g + 1;\n  return { ...rest, o };`],
  ["classes-evaluated-again", `const made = class {\n    a = g;\n    b = g + 1;\n    m() {\n      return this.a * 2;\n    }\n  };\n  return { ...rest, o: new made(), made, hasMethod: true, keys: "a,b" };`],
  ["classes-with-other-fields-each-time", `const made = class {\n    declare a: number;\n    declare b: number;\n    constructor() {\n      (this as any)["f" + (g % 7)] = 0;\n      this.a = g;\n      this.b = g + 1;\n    }\n    m() {\n      return this.a * 2;\n    }\n  };\n  return { ...rest, o: new made(), made, hasMethod: true, keys: "f" + (g % 7) + ",a,b" };`],
  ["prototypes-made-again", `const o = Object.create({\n    inherited: g,\n    m() {\n      return (this as any).a * 2;\n    },\n  });\n  o.a = g;\n  o.b = g + 1;\n  return { ...rest, o, hasMethod: true, inherited: g, keys: "a,b" };`],
  ["prototypes-that-gain-a-key", `const above: any = g % 3 ? {} : { inherited: g };\n  const o = Object.create(above);\n  o.b = g + 1;\n  o.a = g;\n  if (g % 3 === 1) above.inherited = g;\n  return { ...rest, o, inherited: g % 3 === 2 ? undefined : g, keys: "b,a" };`],
  ["constructor-functions-made-again", `const made: any = function (this: any) {\n    this.a = g;\n    this.b = g + 1;\n  };\n  made.prototype.m = function () {\n    return this.a * 2;\n  };\n  return { ...rest, o: new made(), made, hasMethod: true, keys: "a,b" };`],
  ["subclasses-evaluated-again", `const made = class extends Base {\n    b = g + 1;\n    constructor() {\n      super(g);\n    }\n  };\n  return { ...rest, o: new made(), made, hasMethod: true, keys: "a,b" };`],
  ["mixins", `const made = mixed(g % 2 ? Base : Other, g);\n  return { ...rest, o: new made(g), made, hasMethod: true };`],
  ["an-accessor-or-a-value", `const o = g % 2 ? { get a() { return g; }, b: g + 1 } : { a: g, b: g + 1 };\n  return { ...rest, o, keys: "a,b" };`],
  ["very-many-keys", `const o: any = {};\n  for (let n = 0; n < 90; n++) o["k" + n] = n;\n  o.a = g;\n  o.b = g + 1;\n  for (let n = 0; n < 90; n += 1 + (g % 3)) delete o["k" + n];\n  return { ...rest, o };`],
  ["frozen-objects", `const o = Object.freeze(g % 2 ? { a: g, b: g + 1, c: 0 } : { c: 0, a: g, b: g + 1 });\n  return { ...rest, o, isFrozen: true, keys: g % 2 ? "a,b,c" : "c,a,b" };`],
  ["objects-without-a-prototype", `const o = Object.assign(Object.create(null), g % 2 ? { a: g, b: g + 1 } : { b: g + 1, a: g });\n  return { ...rest, o, keys: g % 2 ? "a,b" : "b,a" };`],
  ["arrays-with-properties", `const o = Object.assign([g], { a: g, b: g + 1 });\n  return { ...rest, o, keys: "0,a,b" };`],
  ["functions-with-properties", `const o = Object.assign(() => g, g % 2 ? { a: g, b: g + 1 } : { b: g + 1, a: g });\n  return { ...rest, o, keys: g % 2 ? "a,b" : "b,a" };`],
  ["prototypes-exchanged-later", `const o = { a: g, b: g + 1 };\n  Object.setPrototypeOf(o, g % 2 ? { inherited: g } : { m() { return g * 2; } });\n  return { ...rest, o, hasMethod: g % 2 === 0, inherited: g % 2 ? g : undefined, keys: "a,b" };`],
  ["private-names", `const made = class {\n    #p = g;\n    a = g;\n    b = g + 1;\n    static reads(o: any): number {\n      return #p in o ? o.#p : -1;\n    }\n  };\n  return { ...rest, o: new made(), made, keys: "a,b" };`],
];

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const chosen = random.sample(makers, random.between(2, 6));
  const text: string[] = [prelude.replace("LOOKS", random.shuffled(random.sample(looks, random.between(6, looks.length))).map(each => "  " + each).join("\n"))];
  text.push(`class Base {
  a: number;
  constructor(a: number) {
    this.a = a;
  }
  m(): number {
    return this.a * 2;
  }
}
class Other {
  extra = 0;
  a: number;
  constructor(a: number) {
    this.a = a;
  }
  m(): number {
    return this.a * 2;
  }
}
function mixed(above: typeof Base | typeof Other, g: number): any {
  return class extends (above as typeof Base) {
    b = g + 1;
  };
}`);
  chosen.forEach(([name, body], at) => text.push(`function make${at}(g: number): Made {\n  const rest = { g, kind: "${name}", hasMethod: false, inherited: undefined, made: undefined, isFrozen: false, keys: undefined };\n  ${body}\n}`));
  const churned = pick([0, 0, 200, 2000]);
  text.push(`function otherShapes(g: number): number {
  let sum = 0;
  for (let n = 0; n < ${churned}; n++) {
    const o: any = {};
    o["s" + ((g * 31 + n) % 4099)] = n;
    o[n % 2 ? "a" : "b"] = n;
    sum += Object.keys(o).length;
  }
  return sum;
}`);
  const every = pick([1, 1, 2, 5]);
  const collection = pick(["Bun.gc(true);", "Bun.gc(true);", "Bun.gc(true);\n    Bun.gc(true);", "", "Bun.gc(false);"]);
  const kept = pick([0, 1, 1, 3]);
  text.push(`const makers = [${chosen.map((_, at) => `make${at}`).join(", ")}];
let earlier: (Made | undefined)[] = [];
const kept: Made[] = [];
for (let g = 1; g <= ${churned === 2000 ? 30 : pick([30, 100, 300])}; g++) {
  const now = makers.map(make => make(g));
  ${pick(["for (const made of now) look(made, earlier[now.indexOf(made)]);", "for (let round = 0; round < 3; round++) for (const made of now) look(made, earlier[now.indexOf(made)]);", "for (let at = now.length - 1; at >= 0; at--) look(now[at], earlier[at]);"])}
  earlier = ${pick(["now", "now", "[]"])};
  ${kept ? `if (g % ${kept * 7} === 0) kept.push(now[g % now.length]);` : ""}
  if (g % ${every} === 0) {
    otherShapes(g);
    ${collection}
  }
}
for (const made of kept) look(made, undefined);
console.log("wrong: " + [...wrong].sort().join(", "));`);
  return `// ${chosen.map(([name]) => name).join(" ")}--${churned}-other-shapes--every-${every}\n${text.join("\n")}`;
}
