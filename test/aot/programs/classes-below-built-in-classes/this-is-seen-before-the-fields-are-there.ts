// The constructor of the built-in parent calls members that the class replaces, initial values read other fields and hand `this` on, constructors throw behind `super`, answer with another object or call `super` late.
const lines: string[] = [];
const seen: unknown[] = [];
function attempt(read: () => unknown): string { try { return String(read()); } catch (e) { return "throws " + (e as Error).name; } }
class Early extends Map<string, number> {
  count: number = 5;
  label: string = "l" + this.size;
  set(key: string, value: number): this {
    lines.push("set " + key + " " + typeof this.count + " " + String(this.label) + " " + (this instanceof Early));
    seen.push(this);
    return super.set(key, value + (this.count ?? 100));
  }
  total(): number { let sum = this.count; for (const value of this.values()) sum += value; return sum; }
}
class EarlySet extends Set<number> {
  limit: number = 2;
  add(value: number): this { return this.limit === undefined || this.size < this.limit ? super.add(value) : this; }
  describe(): string { return this.limit + ":" + [...this].join(); }
}
function look(k: Early): string { return k.count + k.label + k.total() + ":" + k.size; }
class HandsOn extends Error {
  first: number = remember(this);
  second: string = "s" + this.first;
}
function remember(k: HandsOn): number { seen.push(k); return k.second === undefined ? 1 : 2; }
function lookAtHandsOn(k: HandsOn): string { return k.first + k.second + k.message; }
class Throws extends Map<string, number> {
  count = 1;
  constructor(fails: boolean) { super(); seen.push(this); if (fails) throw new RangeError("behind super"); this.count = 2; }
}
class ThrowsInField extends Set<number> {
  before = 1;
  broken: number = fail(this);
  after = 3;
}
function fail(k: ThrowsInField): number { seen.push(k); throw new RangeError("in a field"); }
function lookAtBroken(k: ThrowsInField): string { return String(k.before) + String(k.broken) + String(k.after) + k.size; }
function lookAtThrows(k: Throws): string { return String(k.count) + k.size; }
class Answers extends Map<string, number> {
  count = 1;
  constructor(other?: object) { super(); if (other) return other as Answers; }
  twice(): number { return this.count * 2; }
}
function lookAtAnswers(k: Answers): string { return attempt(() => k.count) + attempt(() => k.twice()) + (k instanceof Answers); }
class Late extends Error {
  code: number = 1;
  constructor(text: string) { if (text.length > 1) super(text.toUpperCase()); else super("short"); this.code += text.length; }
}
function lookAtLate(k: Late): string { return k.message + k.code; }
for (let round = 0; round < 3; round++) {
  lines.push(look(new Early([["a", 1], ["b", 2]])), look(new Early()));
  lines.push(new EarlySet([1, 2, 3, 4]).describe());
  lines.push(lookAtHandsOn(new HandsOn("m")));
  lines.push(attempt(() => lookAtThrows(new Throws(false))), attempt(() => lookAtThrows(new Throws(true))));
  lines.push(attempt(() => lookAtBroken(new ThrowsInField([1]))));
  lines.push(lookAtAnswers(new Answers()), lookAtAnswers(new Answers({ count: 9 })), lookAtAnswers(new Answers(new Map())), lookAtAnswers(new Answers(new Answers())));
  lines.push(lookAtLate(new Late("ab")), lookAtLate(new Late("c")));
  Bun.gc(true);
}
for (const each of seen) {
  if (each instanceof Early) lines.push("early " + look(each));
  else if (each instanceof HandsOn) lines.push("hands on " + lookAtHandsOn(each));
  else if (each instanceof Throws) lines.push("throws " + lookAtThrows(each));
  else if (each instanceof ThrowsInField) lines.push("broken " + lookAtBroken(each));
}
console.log(lines.join("\n"));
