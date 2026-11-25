// answers: without-library
// # Every construction fills the field. Later one object gets an accessor in its place, and another is frozen.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
class P { constructor() { this.x = 1; this.y = 2; } }
class Q { constructor() { this.x = 1; } }
function readX(p) { return p.x; }
function storeX(p, v) { try { p.x = v; } catch (e) { return "refused"; } return p.x; }
function readXOfQ(q) { return q.x; }
function storeXOfQ(q, v) { try { q.x = v; } catch (e) { return "refused"; } return q.x; }
const p = new P();
report(readX(p));
Object.defineProperty(p, "x", { get() { return 40; }, configurable: true });
report(readX(p));
report(storeX(p, 5));
report(readX(new P()));
const q = new Q();
report(storeXOfQ(q, 2));
Object.freeze(q);
report(readXOfQ(q));
report(storeXOfQ(q, 3));
report(readXOfQ(q));
report("end");
