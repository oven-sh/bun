// JSON.stringify with a replacer walks the fields of a compiled object as they were listed when the walk began, and reads each when its turn comes:
// what the replacer or a toJSON does to the object in between is seen as the language says.
const launder = new Function("value", process.argv[2] ?? "return value") as <V>(value: V) => V;
const seen: unknown[] = [];
function note(value: unknown): void { seen.push(value === undefined ? "undefined" : value); }
class Record4 { a = 1; b = "two"; c: unknown = true; d: unknown = null; }
type Loose = Record<string, unknown>;

note(JSON.stringify(new Record4(), (key, value) => value));
note(JSON.stringify(launder(new Record4()), (key, value) => typeof value === "number" ? value + 1 : value));
note(JSON.stringify(new Record4(), (key, value) => key === "b" ? undefined : value));
note(JSON.stringify(new Record4(), (key, value) => key === "c" && value === true ? { nested: Object.assign(new Record4(), { c: false }) } : value, 1));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") this.c = "changed"; return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") delete this.c; return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") this.e = "added"; return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") { delete this.b; this.b = "again"; } return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") Object.defineProperty(this, "d", { get() { return "got"; }, enumerable: true, configurable: true }); return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") Object.defineProperty(this, "d", { value: "hidden", enumerable: false }); return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") this.b = 5; return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "b") Object.freeze(this); return value; }));
note(JSON.stringify(new Record4(), function (this: Loose, key, value) { if (key === "a") Object.setPrototypeOf(this, { c: "inherited" }); if (key === "b") delete this.c; return value; }));
class WithToJSON { a = 1; inner = new Record4(); toJSON(key: string): unknown { return { key, a: this.a, inner: this.inner }; } }
note(JSON.stringify({ first: new WithToJSON(), list: [new WithToJSON()] }, (key, value) => value));
class Changes { a = 1; b: { toJSON(): unknown }; c = 3; constructor() { this.b = { toJSON: () => { (this as unknown as Loose).c = "by toJSON"; return "b"; } }; } }
note(JSON.stringify(new Changes())); note(JSON.stringify(new Changes(), (key, value) => value)); note(JSON.stringify(new Changes(), null, "\t"));
class Odd { "quo\"te" = 1; "new\nline" = 2; "é" = 3; "中" = 4; [Symbol.iterator] = 5; 7 = "index"; plain = 6; }
note(JSON.stringify(new Odd(), (key, value) => value)); note(JSON.stringify(launder(new Odd()), (key, value) => value, 2));
const keys: string[] = [];
JSON.stringify(launder({ x: new Record4(), y: [new Record4()] }), function (key, value) { keys.push(key); return value; });
note(keys.join());
note(JSON.stringify(new Record4(), ["d", "a", "missing"])); note(JSON.stringify([new Record4(), new Record4()], ["b"]));
let total = 0;
for (let i = 0; i < 300; i++) total += JSON.stringify(launder([new Record4(), new Record4(), { a: i }]), (key, value) => value).length;
note(total);
console.log(seen.join("\n"));
