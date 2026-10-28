// An object literal begins with the key of a literal that the program hands out, and then gets accessors and values under indexes, the properties of other values by a spread, another prototype, heirs, a level of integrity, or stores by built-in functions. Each form runs as the program's own code and once more as evaluated text.
const base = { inherited: "from base" };

function describe(value: any): string {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? `[${value.map(describe)}]` : "object";
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function show(label: string, object: any): void {
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(object)) {
    const property = Reflect.getOwnPropertyDescriptor(object, key)!;
    const flags = (property.writable ? "w" : "") + (property.enumerable ? "e" : "") + (property.configurable ? "c" : "");
    const held = "value" in property ? describe(property.value) : `${property.get ? "get" : ""}${property.set ? "set" : ""}`;
    parts.push(`${describe(key)}:${held}:${flags}`);
  }
  const prototype = Object.getPrototypeOf(object);
  const above = prototype === Object.prototype ? "Object.prototype" : prototype === base ? "base" : prototype === null ? "null" : Array.isArray(prototype) ? "an array" : "another";
  const level = Object.isFrozen(object) ? "frozen" : Object.isSealed(object) ? "sealed" : Object.isExtensible(object) ? "open" : "closed";
  const listed: string[] = [];
  for (const key in object) listed.push(key);
  console.log(label, "|", parts.join(" "), "|", above, level, "|", listed.join(), "|", JSON.stringify(object));
}

function make(first: any) {
  return { first, __proto__: base };
}
show("handed out", make(1));

type Literal = (key: any, spread: any, base: any) => any;
const literals: Literal[] = [
  key => ({ first: 1, get 42() { return this.first; }, [key]: 2 }),
  key => ({ first: 1, set 42(value: any) { this.first = value; }, [key]: 2 }),
  key => ({ first: 1, get 42() { return this.first; }, set 42(value: any) { this.first = value; }, [key]: 2 }),
  () => ({ first: 1, get 42() { return this.first; } }),
  (key, spread) => ({ first: 1, get 42() { return this.first; }, ...spread }),
  () => ({ first: 1, get [42]() { return this.first; }, set ["42"](value: any) { this.first = value; } }),
  key => ({ first: 1, get 4294967294() { return "index"; }, get 4294967295() { return "name"; }, get 2147483648() { return "index"; }, [key]: 2 }),
  key => ({ first: 1, get 0() { return "zero"; }, get 1.5() { return "fraction"; }, get [-1]() { return "negative"; }, [key]: 2 }),
  () => ({ first: 1, 42: 2, [7]: 1.5, 4294967294: "last", 4294967295: "name" }),
  (key, spread) => ({ first: 1, ...[1.5, , "text"], ...spread }),
  (key, spread, base) => ({ first: 1, __proto__: base, get 42() { return (this as any).inherited; }, [key]: 2 }),
  key => ({ first: 1, get other() { return this.first; }, set other(value: any) {}, [key]: 2 }),
  // @ts-ignore
  key => ({ first: 1, get first() { return "getter"; }, [key]: 2 }),
  // @ts-ignore
  key => ({ first: 1, set first(value: any) {}, get 3() { return this.first; }, [key]: 2 }),
  // @ts-ignore
  (key, spread, base) => ({ first: 1, __proto__: base, 42() { return super.inherited; }, [key]: 2 }),
  () => ({ first: 1, get [Symbol.toStringTag]() { return "tag"; }, get 42() { return 1; } }),
  // @ts-ignore
  key => ({ first: 1, get 42() { return 1; }, 42: 5, [key]: 2 }),
  // @ts-ignore
  key => ({ first: 1, 42: 5, get 42() { return 1; }, [key]: 2 }),
  // @ts-ignore
  () => ({ first: 1, get 42() { return 1; }, [42]: 5 }),
  // @ts-ignore
  key => ({ first: 1, [key]: 2, get 42() { return 1; }, set 42(value: any) {}, get 42() { return 2; } }),
  () => ({ first: 1, ...{ more: 1, other: "text" } }),
  // @ts-ignore
  (key, spread, base) => ({ first: 1, ...base, ...{ first: "text" }, ...base }),
  () => ({ first: 1, ...(null as any), ...(undefined as any), ...("text" as any), ...(5 as any) }),
  () => ({ first: 1, ...{ get more() { return "read"; } }, ...new Proxy({ behind: 1 }, {}) }),
  () => ({ first: 1, ...JSON.parse('{"__proto__":5,"first":1.5}'), ...{ [Symbol.iterator]: 1 } }),
  () => ({ first: 1, ...Object.fromEntries(Array.from({ length: 40 }, (unused, index) => [`key${index}`, index])) }),
  (key, spread) => { const { first, ...rest } = { first: 1, ...spread, [key]: 2 }; return { first, ...rest }; },
];

type Step = (made: any, show: (label: string, object: any) => void, base: any) => void;
const steps: Step[] = [
  made => { made[0] = 1; made[1] = 1.5; made[3] = "text"; },
  made => { made[1000000] = 1; made[4294967294] = 2; made[4294967295] = 3; made[-1] = 4; made[1.5] = 5; },
  made => { Object.defineProperty(made, 3, { value: 1, enumerable: false, configurable: true }); },
  made => { Object.defineProperty(made, 3, { get() { return this.first; }, enumerable: true }); },
  made => { made[3] = 1; Object.defineProperty(made, 3, { writable: false }); made[3] = 2; },
  made => { made[3] = 1; Object.defineProperty(made, 3, { get() { return 9; } }); made[3] = 2; },
  made => { Object.defineProperties(made, { 2: { value: "two" }, 1: { get() { return 1; }, configurable: true } }); },
  made => { Reflect.defineProperty(made, 4294967294, { value: 1, writable: true }); },
  made => { made[2] = 1; Object.preventExtensions(made); made[2] = 3; delete made[2]; made[3] = 2; },
  made => { made[2] = 1; Object.seal(made); made[2] = 3; delete made[2]; },
  made => { made[2] = 1; Object.freeze(made); made[2] = 3; },
  made => { Object.freeze(made); made.first = 5; },
  (made, show) => { const child = Object.create(made); made[5] = "seen"; made.later = "seen"; show("child", child); console.log(child[5], child.later, child.first, 5 in child); },
  (made, show) => { const child: any = { __proto__: made }; Object.defineProperty(made, 5, { set(value) { this.taken = value; } }); child[5] = 1; show("child", child); },
  made => { function Maker() {} Maker.prototype = made; const child = new (Maker as any)(); made[5] = 1.5; console.log(child[5], child instanceof Maker, made.isPrototypeOf(child)); },
  made => { const child: any[] = []; Object.setPrototypeOf(child, made); made[2] = "below"; child.length = 3; console.log(child[2], Array.prototype.indexOf.call(child, "below"), Array.prototype.includes.call(child, "below")); },
  made => { Object.setPrototypeOf(made, null); },
  made => { Object.setPrototypeOf(made, ["element"]); console.log(made[0], made.length); },
  (made, show, base) => { made.__proto__ = base; made[1] = 1; console.log(made.inherited); },
  made => { const child = Object.create(made); Object.setPrototypeOf(made, child); },
  made => { Object.preventExtensions(made); Object.setPrototypeOf(made, []); },
  made => { made[1] = 1; made[2] = 2; delete made[1]; delete made.first; made.first = "again"; made[1] = "again"; },
  made => { made.__defineGetter__(7, function () { return 7; }); made.__defineSetter__(7, function () {}); console.log(typeof made.__lookupGetter__(7), typeof made.__lookupSetter__(7), made[7]); },
  made => { console.log(Reflect.set({}, 3, "given", made), Reflect.set(made, 4, "kept", {}), Reflect.set(Object.create(made), 5, "own", made)); },
  made => { console.log(Array.prototype.push.call(made, 1.5, "text", 3)); },
  made => { made.length = 3; Array.prototype.fill.call(made, 0.5); Array.prototype.unshift.call(made, "front"); Array.prototype.reverse.call(made); },
  made => { made.length = 2; made[0] = 2; made[1] = 1; Array.prototype.sort.call(made); console.log(Array.prototype.splice.call(made, 0, 1, "a", "b"), Array.prototype.pop.call(made), Array.prototype.shift.call(made)); },
  made => { Object.assign(made, [1, 2.5, "text"], { 7: "seven", later: 1 }); },
  made => { made[1] = 1; console.log(Object.entries(made), { ...made }, Object.assign({}, made), structuredClone(made), Array.from({ length: 2, __proto__: made } as any)); },
  made => {
    class Returns { constructor(value: any) { return value; } }
    class Marks extends Returns { #field = 1; #method() { return this.#field; } static read(value: any) { return #field in value && value.#method(); } }
    new Marks(made);
    console.log(Marks.read(made));
    new Marks(made);
  },
];

function attempt(label: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    console.log(label, "throws", (error as Error).name);
  }
}

const evaluate = (form: Function) => (0, eval)(`(${form})`);
const makers: [string, () => any][] = [
  ["made by the program", () => make(1)],
  ["made by text", evaluate(() => ({ first: 1 }))],
  ["parsed", () => JSON.parse('{"first":1}')],
];
show("parsed with indexes", JSON.parse('{"first":1,"42":2,"1.5":3,"4294967294":4,"0":5}'));

for (const [way, prepare] of [["as written", (form: Function) => form], ["evaluated", evaluate]] as const) {
  literals.forEach((literal, index) =>
    attempt(`literal ${index} ${way}`, () => {
      const made = prepare(literal)("later", { 9: "nine", more: 1 }, base);
      show(`literal ${index} ${way}`, made);
      console.log(typeof made[42] === "function" ? made[42]() : made[42], made.first, made.later);
      made[42] = "stored";
      console.log(typeof made[42], made.first);
    }),
  );
  steps.forEach((step, index) => {
    for (const [maker, create] of makers) {
      const made = create();
      attempt(`step ${index} ${way}, ${maker}`, () => prepare(step)(made, show, base));
      show(`step ${index} ${way}, ${maker}`, made);
    }
  });
}
