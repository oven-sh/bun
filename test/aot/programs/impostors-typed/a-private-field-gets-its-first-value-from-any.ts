// Private fields with a declared type are given their first value by a parameter of an outer function, by a call and by parsed text, and the value is of another type.
const strangers: any[] = ["s", null, undefined, { a: 1 }, 1.5, true, 10n, Symbol.iterator, [1], () => 1, -0, NaN, 2 ** 40];
function show(value: unknown): string { try { return typeof value + ":" + String(value); } catch (error) { return "throws " + (error as Error).constructor.name; } }
function attempt(run: () => unknown): string { try { return show(run()); } catch (error) { return "throws " + (error as Error).constructor.name; } }

function makeNumber(v: number) {
  class Box { #x: number = v; read() { return this.#x; } sum() { return this.#x + 1; } bits() { return this.#x | 0; } }
  return new Box();
}
function makeString(v: string) {
  class Box { #x: string = v; read() { return this.#x; } size() { return this.#x.length; } code() { return this.#x.charCodeAt(0); } join() { return this.#x + "!"; } }
  return new Box();
}
function makeRecord(v: { a: number; b: string }) {
  class Box { #x: { a: number; b: string } = v; read() { return this.#x; } a() { return this.#x.a + 1; } b() { return this.#x.b.length; } }
  return new Box();
}
function makeList(v: number[]) {
  class Box { #x: number[] = v; read() { return this.#x; } first() { return this.#x[0] + 1; } size() { return this.#x.length; } }
  return new Box();
}
function lieNumber(i: number): number { return strangers[i]; }
function lieString(i: number): string { return strangers[i]; }
let turn = 0;
class ByCall { #n: number = lieNumber(turn); #s: string = lieString(turn); n() { return this.#n + 1; } s() { return this.#s.length; } rawN() { return this.#n; } rawS() { return this.#s; } }
class ByParse { #n: number = JSON.parse(texts[turn]); #s: string = JSON.parse(texts[turn]); static #k: number = JSON.parse('"static"'); n() { return this.#n * 2; } s() { return this.#s.length; } static k() { return ByParse.#k + 1; } }
var texts = ['"s"', "null", "5", '{"a":1}', "1.5", "true", "[1]", '""', "-0", "1e300", "7", "8", "9"];

for (let warm = 0; warm < 200; warm++) { makeNumber(warm).sum(); makeString("w" + warm).size(); makeRecord({ a: warm, b: "b" }).a(); makeList([warm]).first(); }
for (turn = 0; turn < strangers.length; turn++) {
  const s = strangers[turn];
  const n = makeNumber(s), t = makeString(s), r = makeRecord(s), l = makeList(s);
  console.log(turn, "number", attempt(() => n.read()), attempt(() => n.sum()), attempt(() => n.bits()));
  console.log(turn, "string", attempt(() => t.read()), attempt(() => t.size()), attempt(() => t.code()), attempt(() => t.join()));
  console.log(turn, "record", attempt(() => r.read()), attempt(() => r.a()), attempt(() => r.b()));
  console.log(turn, "list", attempt(() => l.read()), attempt(() => l.first()), attempt(() => l.size()));
  const c = new ByCall(), p = new ByParse();
  console.log(turn, "call", attempt(() => c.rawN()), attempt(() => c.n()), attempt(() => c.rawS()), attempt(() => c.s()));
  console.log(turn, "parse", attempt(() => p.n()), attempt(() => p.s()), attempt(() => ByParse.k()));
}
