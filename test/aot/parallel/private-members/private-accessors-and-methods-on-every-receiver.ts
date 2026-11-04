// Private accessors and methods.
class A {
  #v = 1;
  get #both() { return this.#v; } set #both(v: number) { this.#v = v; }
  get #onlyGet() { return this.#v * 2; }
  set #onlySet(v: number) { this.#v = v * 3; }
  #method(n: number) { return this.#v + n; }
  both() { this.#both += 1; return this.#both; }
  readOnlySet() { return (this as any).#onlySet; }
  writeOnlyGet() { (this as any).#onlyGet = 1; }
  writeMethod() { (this as any).#method = 1; }
  incOnlyGet() { (this as any).#onlyGet++; }
  ok() { this.#onlySet = 2; return this.#onlyGet + this.#method(1); }
  taken() { const m = this.#method; return m.call(this, 5) + (m === this.#method ? 1 : 0); }
  static on(o: any) { return o.#both + o.#method(1); }
  static put(o: any) { o.#both = 4; }
}
class B extends A {}
function attempt(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e: any) { console.log(name, e instanceof TypeError, e.constructor.name); } }
const a = new A(), b = new B();
for (let round = 0; round < 3; round++) {
  for (const [n, o] of [["a", a], ["b", b]] as const) {
    attempt(n + " both", () => o.both()); attempt(n + " readOnlySet", () => o.readOnlySet()); attempt(n + " writeOnlyGet", () => o.writeOnlyGet());
    attempt(n + " writeMethod", () => o.writeMethod()); attempt(n + " incOnlyGet", () => o.incOnlyGet()); attempt(n + " ok", () => o.ok()); attempt(n + " taken", () => o.taken());
    attempt(n + " on", () => A.on(o)); attempt(n + " put", () => A.put(o));
  }
  attempt("on {}", () => A.on({})); attempt("put {}", () => A.put({})); attempt("on null", () => A.on(null)); attempt("both.call", () => A.prototype.both.call({} as any));
}
let t = 0; for (let i = 0; i < 1000; i++) t += a.both() + a.ok() + a.taken(); console.log(t);
