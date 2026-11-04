// A private field holds whatever is stored: numbers of every kind, undefined, objects, functions; read-modify-write forms.
class Box { #v: any; #n = 0; #d = 0.5; #s = ""; #o: { k: number } | null = null; #u: undefined | number; #big = 1n;
  set(v: any) { this.#v = v; return this; } get() { return this.#v; }
  work(i: number) { this.#n += i; this.#n |= 0; this.#d *= 1.5; this.#s += i; this.#o ??= { k: i }; this.#o.k++; this.#u ||= i; this.#u &&= this.#u + 1; this.#big += 1n; this.#n++; --this.#n; this.#d **= 1; return this; }
  all() { return [this.#n, this.#d, this.#s, this.#o?.k, this.#u, this.#big, typeof this.#v].join("|"); }
  overflow() { this.#n = 2147483647; this.#n++; const a = this.#n; this.#n = -0; const b = Object.is(this.#n, -0); this.#n = NaN; const c = this.#n; this.#n = 1e300; return [a, b, c, this.#n].join(); }
  swap(o: Box) { [this.#v, o.#v] = [o.#v, this.#v]; ({ a: this.#n, b: o.#n } = { a: 1, b: 2 }); return this.#n + o.#n; }
  chain(o?: Box) { return o == null ? undefined : o.#v; }
}
const b = new Box(); for (let i = 1; i < 6; i++) b.work(i); console.log(b.all());
for (const v of [1, 1.5, "s", null, undefined, {}, [], () => 1, Symbol.iterator, 1n, true, -0, NaN]) console.log(typeof b.set(v).get(), Object.is(b.get(), v));
console.log(b.overflow(), b.swap(new Box().set(3)), b.get(), b.chain(), b.chain(b));
