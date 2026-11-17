// answers: without-library
// # If a getter or a setter that a literal defines were taken for a value in a slot, the read would not run it, a store would hide it, and an object made below the literal would not be its `this`. A getter that defines its own name anew, one that throws, and a name with only one half are among them.
// # At the end the shell runs the same text itself: every answer is the same.
// # The program or the shell runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 16 of 16 of 16
// # CHECK-NEXT: exited with 0
function make(start) {
  let reads = 0;
  const o = {
    a: start,
    held: { b: start + 1 },
    get x() { reads++; return this.a; },
    set x(v) { this.a = v * 2; },
    get lazy() { const made = { c: this.a }; Object.defineProperty(this, "lazy", { value: made }); return made; },
    get only() { return "only"; },
    set sink(v) { this.held = { b: v }; },
    count() { return reads; },
  };
  return o;
}
const o = make(1);
report(o.x);
o.x = 5;
report(o.x);
report(o.a);
report(o.count());
report(o.lazy.c);
report(o.lazy === o.lazy);
try { o.only = "stored"; report("stored"); } catch (e) { report(e.name); }
report(o.only);
report(o.sink);
o.sink = 9;
report(o.held.b);
report(Object.keys(o).join());
const below = Object.create(o);
below.a = 40;
report(below.x);
below.x = 4;
report(below.a + " " + o.a);
let total = 0;
for (let i = 0; i < 300; i++) { const p = make(i); p.x = i; total += p.x + p.held.b + p.lazy.c; }
report(total);
function thrower() { return { get bad() { throw new RangeError("bad"); } }; }
try { thrower().bad; report("no throw"); } catch (e) { report(e.name + e.message); }
report("end");
