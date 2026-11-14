// answers: without-library
// # A field that one way through the constructor leaves out (a branch, a loop that may not turn, a switch without a default) is not filled. One that both arms store is.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
class P { constructor(v) { if (v) this.x = 1; this.y = 2; } }
class Q { constructor(v) { if (v) this.x = 1; else this.x = 3; this.y = 2; } }
class R { constructor(n) { for (let i = 0; i < n; i++) this.x = i; this.y = 2; } }
class S { constructor(v) { switch (v) { case 0: this.x = 10; break; case 1: this.x = 11; break; } this.y = 2; } }
function readX(p) { return p.x; }
function readXOfQ(q) { return q.x; }
function readXOfR(r) { return r.x; }
function readXOfS(s) { return s.x; }
report(readX(new P(true)));
report(readX(new P(false)));
report(readXOfQ(new Q(true)));
report(readXOfQ(new Q(false)));
report(readXOfR(new R(0)));
report(readXOfR(new R(3)));
report(readXOfS(new S(0)));
report(readXOfS(new S(1)));
report(readXOfS(new S(2)));
report("end");
