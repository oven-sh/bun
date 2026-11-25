// answers: without-library
// # A getter or a setter that the constructor comes to by a read or an assignment on this, its own class's, a subclass's or one found through super, gets the object half built.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 12 of 12 of 12
// # CHECK-NEXT: exited with 0
class P { constructor() { this.first = this.peek; this.x = 3; this.second = this.peek; } get peek() { return this.x; } }
class Q { constructor() { this.value = 1; this.x = 3; } set value(v) { this.seen = this.x; } }
class A { constructor() { this.tag = 1; } }
class B extends A { constructor() { super(); this.y = 6; } set tag(v) { this.seen = this.y; } }
class G { get peek() { return this.y; } }
class H extends G { constructor() { super(); this.first = super.peek; this.y = 2; this.second = super.peek; } }
function readX(p) { return p.x; }
const p = new P();
report(p.first);
report(p.second);
report(readX(p));
const q = new Q();
report(q.seen);
report("seen" in q);
report(readX(q));
const b = new B();
report(b.seen);
report("seen" in b);
report(b.y);
const h = new H();
report(h.first);
report(h.second);
report("end");
