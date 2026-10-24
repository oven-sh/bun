// `for (const name of names) Object.defineProperty(flags, name, { get })` on an object whose type has the names as options. Some names get a getter, some a value, some nothing; getters are replaced, deleted and
// defined in another form; the object is copied, listed, frozen. All but the getters of the one form is done by text that the build does not see.
type Flags = { FIRST?: unknown; SECOND?: unknown; THIRD?: unknown; FOURTH?: unknown; FIFTH?: unknown };
const table: Record<string, string | undefined> = { FIRST: "1", THIRD: "x" };
let calls = 0;
function getterOf(key: string): () => unknown { return () => { calls++; return table[key]; }; }
function make(names: string[]): Flags {
  const flags = {} as Flags;
  for (const name of names) Object.defineProperty(flags, name, { get: getterOf(name), configurable: true, enumerable: true });
  return flags;
}
const text = (body: string) => new Function("object", "key", "value", process.argv.length > 99 ? "" : body) as (object: unknown, key?: string, value?: unknown) => any;
const store = text("object[key] = value"), remove = text("delete object[key]"), below = text("return Object.create(object)"), freeze = text("return Object.freeze(object)");
const defineValue = text("Object.defineProperty(object, key, { value, writable: true, configurable: true, enumerable: true })");
const defineHidden = text("Object.defineProperty(object, key, { get: value, configurable: true, enumerable: false })");
const defineSame = text("Object.defineProperty(object, key, { get: value, configurable: true, enumerable: true })");
const storeStrictly = text("'use strict'; object[key] = value");
const words = (text: string) => (process.argv.length > 99 ? "" : text).split(",");
function read(flags: Flags): string { return [flags.FIRST, flags.SECOND, flags.THIRD, flags.FOURTH, flags.FIFTH].map(String).join("|"); }
function walk(flags: Flags, turns: number): string { let last = ""; for (let i = 0; i < turns; i++) last = read(flags); return last; }

const look = text("return [Object.keys(object).join(), JSON.stringify(object), JSON.stringify({ ...object }), 'FOURTH' in object, Object.hasOwn(object, 'SECOND'), JSON.stringify(Object.getOwnPropertyDescriptor(object, 'THIRD')), typeof Object.getOwnPropertyDescriptor(object, 'FIRST')?.get, Object.isFrozen(object)].join(' ')");

const some = make(words("FIRST,SECOND,THIRD"));
console.log(walk(some, 500), calls, look(some));
table.SECOND = "two";
console.log(walk(some, 500), calls);
store(some, "FOURTH", 4);
store(some, "FIFTH", "five");
console.log(walk(some, 500), look(some));
defineSame(some, "FIRST", () => "again");
console.log(walk(some, 500), look(some));
defineHidden(some, "FIRST", () => "hidden");
console.log(walk(some, 500), look(some));
defineValue(some, "THIRD", 3);
console.log(walk(some, 500), look(some));
remove(some, "SECOND");
console.log(walk(some, 500), look(some));
try { storeStrictly(some, "FIRST", 1); console.log("stored"); } catch (error) { console.log((error as Error).constructor.name); }

const none = make(words(""));
console.log(walk(none, 500), look(none));
const all: Flags = freeze(make(words("FIFTH,FOURTH,THIRD,SECOND,FIRST")));
console.log(walk(all, 500), look(all));
const heir: Flags = below(all);
console.log(walk(heir, 500), look(heir));
const thrower = make(words("FIRST"));
defineSame(thrower, "SECOND", () => { throw new RangeError("no"); });
try { walk(thrower, 3); } catch (error) { console.log((error as Error).constructor.name, (error as Error).message); }
const self = make(words("THIRD"));
defineSame(self, "FIRST", function (this: Flags) { return this === self; });
console.log(walk(self, 500), calls);
