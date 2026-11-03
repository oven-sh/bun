// A private field is read in a method whose receiver nobody has proven: an instance of the class, of an heir, of another evaluation of the class, an object a constructor returned, and what has no such field.
function unknown<T>(value: T): any { return (JSON.parse("[0]") as unknown[]).map(() => value)[0]; }
function attempt(label: string, run: () => unknown): void {
  try { console.log(label, String(run())); } catch (error) { console.log(label, (error as Error).constructor.name); }
}

class Kinds {
  #integer = 7; #double = 1.5; #text = "text"; #yes = true; #no = false; #nothing = null; #absent = undefined;
  #object = { k: 1 }; #list = [1, 2]; #optional?: number; #either: number | string = 3; #big = 2 ** 40; #negativeZero = -0; #notANumber = NaN;
  #closure = () => this.#integer + 1; #symbol = Symbol.for("s"); #bigint = 12n;
  integer() { return this.#integer; } double() { return this.#double; } text() { return this.#text; } yes() { return this.#yes; } no() { return this.#no; }
  nothing() { return this.#nothing; } absent() { return this.#absent; } object() { return this.#object; } list() { return this.#list; } optional() { return this.#optional; }
  either() { return this.#either; } big() { return this.#big; } negativeZero() { return this.#negativeZero; } notANumber() { return this.#notANumber; }
  closure() { return this.#closure; } symbol() { return this.#symbol; } bigint() { return this.#bigint; }
  change() { this.#integer = 2 ** 31; this.#double = 2; this.#text = ""; this.#yes = false; this.#optional = 4; this.#either = "now text"; this.#object = { k: 2 }; this.#nothing = null; }
}
const names = ["integer", "double", "text", "yes", "no", "nothing", "absent", "object", "list", "optional", "either", "big", "negativeZero", "notANumber", "symbol", "bigint"];
const kinds = unknown(new Kinds());
for (let round = 0; round < 2; round++) {
  for (const name of names) { const value = kinds[name](); console.log(name, typeof value, typeof value === "object" ? JSON.stringify(value) : String(value), Object.is(value, -0)); }
  console.log(kinds.closure()(), kinds.object() === kinds.object());
  kinds.change();
}

// Heirs keep the fields of the classes above them, each under its own name.
class Base { #value = "base"; #only = 1; value() { return this.#value; } only() { return this.#only; } static read(o: any) { return o.#value; } }
class Heir extends Base { #value = "heir"; more = 1; heirValue() { return this.#value; } }
class SecondHeir extends Heir { #value = "second"; #extra = [3]; secondValue() { return this.#value + this.#extra.length; } }
for (const o of [unknown(new Base()), unknown(new Heir()), unknown(new SecondHeir())]) {
  console.log(o.value(), o.only(), Base.read(o), o.heirValue?.(), o.secondValue?.());
  attempt("heir's on it", () => Heir.prototype.heirValue.call(o));
  attempt("second heir's on it", () => SecondHeir.prototype.secondValue.call(o));
}

// Every evaluation of a class has names of its own.
function make(tag: string) { return class Made { #tag = tag; tag() { return this.#tag; } static has(o: object) { return #tag in o; } }; }
const First = make("first"), Second = make("second");
const first = unknown(new First()), second = unknown(new Second());
console.log(first.tag(), second.tag(), First.has(first), First.has(second), Second.has(second), Second.has(first));
attempt("first's on second", () => First.prototype.tag.call(second));
attempt("second's on first", () => Second.prototype.tag.call(first));
for (let i = 0; i < 4; i++) { const Again = make("again" + i); console.log(unknown(new Again()).tag()); attempt("on first", () => Again.prototype.tag.call(first)); }

// What has no such field.
const read = Kinds.prototype.integer, readText = Kinds.prototype.text;
for (const [label, receiver] of [["plain", {}], ["array", []], ["function", () => 1], ["number", 5], ["string", "s"], ["null", null], ["undefined", undefined], ["other class", new Base()],
  ["proxy", new Proxy(new Kinds(), {})], ["heir by prototype", Object.create(new Kinds())], ["same keys", { integer: 7 }], ["symbol", Symbol("x")], ["map", new Map()]] as [string, unknown][]) {
  attempt(label, () => read.call(unknown(receiver))); attempt(label, () => readText.call(unknown(receiver)));
}

// A field is there from its own initializer on.
class Order {
  #early = this.peek("early"); #late = "late"; seen: string[] = [];
  peek(when: string): string { try { return when + ":" + this.#late; } catch (error) { return when + ":" + (error as Error).constructor.name; } }
  early() { return this.#early; }
}
const order = unknown(new Order());
console.log(order.early(), order.peek("afterwards"));

// An object that a constructor returned takes the names of the classes below.
class Returns { constructor(o: object) { return o; } }
class Stamp extends Returns { #stamp: unknown; constructor(o: object, stamp: unknown) { super(o); this.#stamp = stamp; } static read(o: any) { return o.#stamp; } static has(o: any) { return #stamp in o; } }
const targets: any[] = [{}, [], () => 1, new Map(), new Base(), new Kinds(), Object.freeze({ frozen: 1 }), new Proxy({}, {}), Object.create(null)];
targets.forEach((target, index) => { new Stamp(target, index % 2 ? "stamp" + index : index + 0.5); });
for (const target of targets) console.log(Stamp.has(unknown(target)), Stamp.read(unknown(target)));
attempt("twice", () => new Stamp(targets[0], 1));
attempt("no stamp", () => Stamp.read(unknown({})));
for (let i = 0; i < 12; i++) { const o: Record<string, number> = {}; for (let k = 0; k <= i; k++) o["k" + k] = k; new Stamp(o, i); console.log(Stamp.read(unknown(o)), Object.keys(o).length); }

// Methods, accessors and static members.
class Members {
  #field = 1; static #count = 0; static #bump() { return ++Members.#count; }
  #method() { return this.#field + 1; } get #got() { return this.#field + 2; } set #got(v: number) { this.#field = v; }
  method() { return this.#method(); } got() { return this.#got; } set(v: number) { this.#got = v; return this.#field; } sameMethod(o: any) { return this.#method === o.#method; }
  static bump() { return Members.#bump(); } static count(c: any) { return c.#count; }
}
const members = unknown(new Members());
console.log(members.method(), members.got(), members.set(5), members.method(), members.sameMethod(unknown(new Members())), Members.bump(), Members.bump(), Members.count(unknown(Members)));
attempt("method on plain", () => Members.prototype.method.call(unknown({})));
attempt("getter on plain", () => Members.prototype.got.call(unknown({})));
attempt("static on heir", () => Members.count(unknown(class extends Members {})));

// Many objects, read while the collector runs.
class Cell { #next: Cell | null; #payload: { n: number }; constructor(next: Cell | null, n: number) { this.#next = next; this.#payload = { n }; } next() { return this.#next; } payload() { return this.#payload; } }
let head: any = null;
for (let i = 0; i < 5000; i++) head = unknown(new Cell(head, i));
Bun.gc(true);
let total = 0;
for (let cell = head; cell; cell = unknown(cell.next())) total += cell.payload().n;
console.log(total);
