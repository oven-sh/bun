// answers: without-library
// # A private field takes whatever is stored, through every form of assignment.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 31 of 31 of 31
// # CHECK-NEXT: exited with 0
class Box { #v: any; #n = 0; #d = 0.5; #s = ""; #o: { k: number } | null = null; #u: undefined | number; set(v: any) { this.#v = v; return this; } get() { return this.#v; } work(i: number) { this.#n += i; this.#n |= 0; this.#d *= 1.5; this.#s += i; this.#o ??= { k: i }; this.#o.k++; this.#u ||= i; this.#u &&= this.#u + 1; this.#n++; --this.#n; return this; } n() { return this.#n; } d() { return this.#d; } s() { return this.#s; } k() { return this.#o === null ? -1 : this.#o.k; } u() { return this.#u; } overflow() { this.#n = 2147483647; this.#n++; const a = this.#n; this.#n = -0; const b = Object.is(this.#n, -0); this.#n = NaN; const c = this.#n; this.#n = 1e300; return a + " " + b + " " + c + " " + this.#n; } swap(o: Box) { const held = this.#v; this.#v = o.#v; o.#v = held; ({ a: this.#n, b: o.#n } = { a: 1, b: 2 }); return this.#n + o.#n; } }
const b = new Box();
for (let i = 1; i < 6; i++) b.work(i);
report(b.n());
report(b.d());
report(b.s());
report(b.k());
report(b.u());
const object = {};
const values: any[] = [1, 1.5, "s", null, undefined, object, true, -0, NaN, 2147483648, -2147483649];
for (let i = 0; i < values.length; i++) { report(typeof b.set(values[i]).get()); report(Object.is(b.get(), values[i])); }
report(b.overflow());
report(b.swap(new Box().set(3)));
report(b.get());
report("end");
