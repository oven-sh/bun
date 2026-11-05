// answers: without-library
// # Private methods and accessors: the brand is asked, then the function of the class is called. A store to a method, a read of a setter alone and a store to a getter alone throw.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 47 of 47 of 47
// # CHECK-NEXT: exited with 0
class A { #v = 1; get #both() { return this.#v; } set #both(v: number) { this.#v = v; } get #onlyGet() { return this.#v * 2; } set #onlySet(v: number) { this.#v = v * 3; } #method(n: number) { return this.#v + n; } both() { this.#both += 1; return this.#both; } ok() { this.#onlySet = 2; return this.#onlyGet + this.#method(1); } taken() { const m = this.#method; return m === this.#method ? 1 : 0; } static on(o: any) { return o.#both + o.#method(1); } static put(o: any) { o.#both = 4; } }
class B extends A { own = 1; }
function attempt(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const objects: A[] = [new A(), new B()];
for (let round = 0; round < 3; round++) { for (let i = 0; i < 2; i++) { const o = objects[i]; attempt(() => o.both()); attempt(() => o.ok()); attempt(() => o.taken()); attempt(() => A.on(o)); attempt(() => A.put(o)); } attempt(() => A.on({})); attempt(() => A.put({})); attempt(() => A.on(null)); const borrowed: any = { both: A.prototype.both, ok: A.prototype.ok }; attempt(() => borrowed.both()); attempt(() => borrowed.ok()); }
let t = 0;
const a = objects[0];
for (let i = 0; i < 300; i++) t += a.both() + a.ok() + a.taken();
report(t);
report("end");
