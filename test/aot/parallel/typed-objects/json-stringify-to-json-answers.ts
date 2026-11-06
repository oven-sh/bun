// A member with toJSON, written by compiled code: toJSON runs once, is told the key, and what it answers is written without another toJSON.
class Answers<T> {
  calls: string[] = [];
  constructor(public answer: () => T) {}
  toJSON(key: string): T {
    this.calls.push(typeof key + ":" + key);
    return this.answer();
  }
}
interface Row { id: number; a: Answers<unknown>; list: Answers<unknown>[]; tail: string }
const write = (row: Row): string => JSON.stringify(row);
const writeOne = (holder: { only: unknown }): string => JSON.stringify(holder);
const say = (name: string, run: () => unknown) => {
  try { console.log(name, String(run())); } catch (error) { console.log(name, "throws", (error as Error).name, (error as Error).message); }
};
const answers: [string, () => unknown][] = [
  ["integer", () => 7],
  ["negative zero", () => -0],
  ["fraction", () => 1.5],
  ["large", () => 1e21],
  ["NaN", () => NaN],
  ["true", () => true],
  ["false", () => false],
  ["null", () => null],
  ["undefined", () => undefined],
  ["symbol", () => Symbol("s")],
  ["function", () => () => 1],
  ["bigint", () => 10n],
  ["string", () => "text"],
  ["empty string", () => ""],
  ["string with escapes", () => 'a"b\\c\nd'],
  ["wide string", () => "日本"],
  ["rope", () => "abcdefghijklmnop".repeat(2) + String(Math.max(1, 2))],
  ["long string", () => "x".repeat(70000)],
  ["long wide string", () => "語".repeat(70000)],
  ["object", () => ({ x: 1 })],
  ["array", () => [1, "two", null]],
  ["date", () => new Date(5)],
  ["invalid date", () => new Date(NaN)],
  ["number object", () => new Number(3)],
  ["string object", () => new String("boxed")],
  ["boolean object", () => new Boolean(false)],
  ["an object with toJSON", () => ({ toJSON: () => "never", kept: 1 })],
  ["another of its kind", () => new Answers(() => "never")],
  ["raw", () => (JSON as any).rawJSON?.("12") ?? 12],
];
for (const [name, answer] of answers) {
  const a = new Answers(answer);
  const inList = new Answers(answer);
  say(name, () => {
    const text = write({ id: 1, a, list: [inList, inList], tail: "t" });
    return (text.length > 200 ? text.length : text) + " " + a.calls.join() + " " + inList.calls.join();
  });
}
const thrower = new Answers(() => { throw new RangeError("from toJSON"); });
say("throws", () => write({ id: 1, a: thrower, list: [], tail: "t" }));
const self: Answers<unknown> = new Answers(() => self);
say("answers itself", () => write({ id: 1, a: self, list: [], tail: "t" }));
const outer: { only: unknown } = { only: null };
outer.only = new Answers(() => outer);
say("answers its holder", () => writeOne(outer));
const nested: { only: unknown } = { only: new Answers(() => ({ deep: { deeper: nested } })) };
say("answers what holds its holder", () => writeOne(nested));
const rowOfChanges: Row = { id: 1, a: new Answers(() => { rowOfChanges.tail = "changed"; (rowOfChanges as any).added = 1; return 1; }), list: [], tail: "t" };
say("changes its holder", () => write(rowOfChanges));
say("stringifies inside", () => write({ id: 1, a: new Answers(() => JSON.stringify({ inner: new Answers(() => 2) })), list: [], tail: "t" }));
let chain: unknown = 0;
for (let i = 0; i < 200; i++) { const inner = chain; chain = new Answers(() => inner); }
say("a chain", () => writeOne({ only: chain }));
const own = { toJSON(this: unknown, key: string) { return [key, this === own]; } };
say("this and key", () => writeOne({ only: own }));
say("key of an element", () => JSON.stringify([own, own]));
say("not a function", () => writeOne({ only: { toJSON: 5, x: 1 } }));
let reads = 0;
say("a getter", () => writeOne({ only: { get toJSON() { reads++; return () => reads; } } }) + reads);
say("a getter that throws", () => writeOne({ only: { get toJSON(): () => number { throw new TypeError("from the getter"); } } }));
say("inherited", () => writeOne({ only: Object.create({ toJSON: () => "inherited" }) }));
const seen: string[] = [];
const proxied = new Proxy({ x: 1 }, { get(target, key) { seen.push(String(key)); return key === "toJSON" ? () => "from the proxy" : (target as any)[key]; } });
say("a proxy", () => writeOne({ only: proxied }) + seen.join());
say("below a proxy", () => writeOne({ only: Object.create(new Proxy({}, { get: (_, key) => { seen.push("below " + String(key)); return key === "toJSON" ? () => "below" : undefined; } })) }) + seen.join());
const list: unknown[] = [1, 2];
(list as any).toJSON = () => "a list";
say("a list", () => writeOne({ only: list }));
say("a function", () => writeOne({ only: Object.assign(() => 1, { toJSON: () => "a function" }) }));
(BigInt.prototype as any).toJSON = function () { return "big " + String(this); };
say("bigint with toJSON", () => writeOne({ only: 5n }));
say("bigint answered with toJSON", () => writeOne({ only: new Answers(() => 5n) }));
delete (BigInt.prototype as any).toJSON;
