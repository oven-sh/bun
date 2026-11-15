// answers: without-library
// # A throw in the middle of a guarded block of the constructor leaves out what the block stores behind it.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
function fail() { throw 1; }
function pass() { return 1; }
class P { constructor(f) { try { this.a = 1; f(); this.b = 2; } catch (e) { this.c = 3; } this.d = 4; } }
class Q { constructor(f) { try { f(); this.a = 1; } finally { this.b = 2; } } }
function readA(p) { return p.a; }
function readB(p) { return p.b; }
function readC(p) { return p.c; }
function readD(p) { return p.d; }
const good = new P(pass);
const bad = new P(fail);
report(readA(good));
report(readB(good));
report(readC(good));
report(readD(good));
report(readA(bad));
report(readB(bad));
report(readC(bad));
report(readD(bad));
report(new Q(pass).a);
let caught = 0;
try { new Q(fail); } catch (e) { caught = e; }
report(caught);
report("end");
