// answers: without-library
// # A constructor that returns another object lets the class below define its names on an object that has no such layout. A second definition throws.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 76 of 76 of 76
// # CHECK-NEXT: exited with 0
class Return { constructor(o: any) { return o; } }
class Stamp extends Return { #x = 1; #m() { return "m" + this.#x; } constructor(o: any) { super(o); } static get(o: any) { return o.#x; } static set(o: any, v: number) { o.#x = v; } static has(o: any) { return #x in o; } static call(o: any) { return o.#m(); } }
class Point { x = 1; y = 2; }
function attempt(f: () => unknown) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const point = new Point();
const own = new Stamp(undefined);
const foreign: any[] = [{ a: 1 }, point, [1, 2], function () {}, Object.freeze({ f: 1 }), Stamp, new Point()];
for (let i = 0; i < foreign.length; i++) { const o = foreign[i]; attempt(() => Stamp.has(o)); attempt(() => Stamp.get(o)); attempt(() => new Stamp(o) === o); attempt(() => Stamp.has(o)); attempt(() => Stamp.get(o)); attempt(() => Stamp.set(o, 5)); attempt(() => Stamp.get(o)); attempt(() => Stamp.call(o)); attempt(() => new Stamp(o)); attempt(() => Stamp.get(o)); }
attempt(() => Stamp.get(own));
attempt(() => new Stamp(own));
attempt(() => Stamp.get(own));
report(point.x + point.y);
let sum = 0;
const mixed: any[] = [own, foreign[0], point, new Stamp(undefined)];
for (let i = 0; i < 400; i++) { const o = mixed[i & 3]; Stamp.set(o, Stamp.get(o) + 1); sum += Stamp.get(o); }
report(sum);
report("end");
declare function report(value: unknown): void;
