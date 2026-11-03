class Cells extends Array<number> {
  put(i: number, v: number): void { this[i] = v; }
  fillUp(n: number): void { for (let i = 0; i < n; i++) this[i] = i * 2; }
  bump(): void { for (let i = 0; i < this.length; i++) this[i] = this[i]! + 1; }
}
class Words extends Array<string> { put(i: number, v: string): void { this[i] = v; } }
class Things extends Array<unknown> { put(i: number, v: unknown): void { this[i] = v; } }
function of(...items: number[]): Cells { const c = new Cells(); for (const item of items) c.push(item); return c; }
function show(tag: string, list: unknown[]): void { console.log(tag, list.length, JSON.stringify(list), Object.keys(list).join(), list.constructor.name); }
function attempt(tag: string, f: () => void): void { try { f(); console.log(tag, "stored"); } catch (e) { console.log(tag, (e as Error).constructor.name); } }
function outside(c: Cells, i: number, v: number): void { c[i] = v; }
function untyped(c: any, i: any, v: any): void { c[i] = v; }
for (let turn = 0; turn < 3; turn++) {
  let c = of(1, 2, 3); c.put(0, 9); c.put(2, 7); show("inside", c);
  c.put(3, 4); show("append", c); c.put(6, 6); show("past", c); c.put(100000, 1); console.log("far", c.length, c[100000], c[5]);
  c = of(1, 2, 3); c.put(-1, 5); c.put(1.5, 6); c.put(NaN, 7); c.put(4294967295, 8); c.put(4294967294, 9); console.log("names", c.length, Object.keys(c).slice(-5).join());
  c = of(1, 2, 3); c.put(1, 0.5); show("fraction", c); c.put(0, NaN); show("nan", c); console.log(Object.is(c[0], NaN), 0 in c); c.put(2, -0); console.log(Object.is(c[2], -0)); c.put(1, 2 ** 40); show("large", c);
  c = of(1, 2, 3); (c as any).put(1, "text"); show("text", c); (c as any).put(0, undefined); show("undefined", c); console.log(0 in c); (c as any).put(2, { a: 1 }); show("object", c);
  c = new Cells(); c.fillUp(5); show("filled", c); c.bump(); show("bumped", c);
  c = new Cells(4); c.put(2, 1); show("hole", c); c.bump(); show("bumped holes", c);
  const w = new Words(); w.put(0, "a"); w.put(1, "b"); show("words", w); const t = new Things(); t.put(0, 1); t.put(1, "x"); t.put(2, null); t.put(3, 1.5); show("things", t);
  c = of(1, 2, 3); Object.freeze(c); attempt("frozen", () => c.put(0, 9)); attempt("frozen append", () => c.put(3, 9)); show("frozen", c);
  c = of(1, 2, 3); Object.seal(c); attempt("sealed", () => c.put(0, 9)); attempt("sealed append", () => c.put(3, 9)); show("sealed", c);
  c = new Cells(3); c[0] = 1; Object.preventExtensions(c); attempt("closed", () => c.put(0, 9)); attempt("closed hole", () => c.put(1, 9)); attempt("closed append", () => c.put(3, 9)); show("closed", c);
  c = of(1, 2, 3); Object.defineProperty(c, "length", { writable: false }); attempt("fixed", () => c.put(0, 9)); attempt("fixed append", () => c.put(3, 9)); show("fixed", c);
  c = of(1, 2, 3); Object.defineProperty(c, 1, { value: 5, writable: false }); attempt("read-only", () => c.put(1, 9)); attempt("beside", () => c.put(0, 9)); show("read-only", c);
  c = of(1, 2, 3); Object.defineProperty(c, 1, { set(v) { console.log("own setter", v); }, get() { return 0; } }); attempt("setter", () => c.put(1, 9)); show("setter", c);
  c = of(1, 2, 3); outside(c, 1, 8); untyped(c, 2, 9); untyped(c, "0", 7); untyped(c, 3, "s"); show("outside", c); untyped([1, 2], 0, 5); untyped({}, 0, 5);
}
(Cells.prototype as any)[1] = 50;
let c = new Cells(3); c.put(1, 2); show("over plain", c); console.log(Object.hasOwn(c, 1), (Cells.prototype as any)[1]);
delete (Cells.prototype as any)[1];
let holes = new Cells(3), full = of(1, 2, 3), short = of(1);
Object.defineProperty(Cells.prototype, 1, { value: 60, writable: false, configurable: true });
attempt("over read-only", () => holes.put(1, 2)); show("over read-only", holes); attempt("own over read-only", () => full.put(1, 5)); show("own", full); attempt("append over read-only", () => short.put(1, 5)); show("append", short);
delete (Cells.prototype as any)[1];
holes = new Cells(4); short = of(1, 2);
Object.defineProperty(Cells.prototype, 2, { set(v) { console.log("setter above", v); }, get() { return -2; }, configurable: true });
attempt("over setter", () => holes.put(2, 3)); show("over setter", holes); attempt("append over setter", () => short.put(2, 3)); show("append", short); attempt("fill over setter", () => short.fillUp(4)); show("filled", short);
delete (Cells.prototype as any)[2];
c = of(1, 2); c.put(2, 3); c.fillUp(4); show("again", c);
Object.defineProperty(Cells.prototype, "-1", { set(v) { console.log("setter -1", v); }, configurable: true });
Object.defineProperty(Cells.prototype, "1.5", { set(v) { console.log("setter 1.5", v); }, configurable: true });
c = of(1, 2); for (let turn = 0; turn < 3; turn++) { c.put(-1, turn); c.put(1.5, turn); c.put(0, turn); outside(c, -1, turn); untyped(c, "1.5", turn); } show("names above", c);
