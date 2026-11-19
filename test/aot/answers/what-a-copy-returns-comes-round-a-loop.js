// answers: without-library
// # Link proves the result of a function by rules of its own: it follows a read into a getter, and a call into a built-in. In a loop the callee is copied, and what the copy returns is typed by the rows of its operations, which may say less.
// # The looks at the loop type the call by both, so the build does not stop where the result comes round.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 6 of 6 of 6
// # CHECK-NEXT: exited with 0
class Meter { get value() { return 1; } }
function read(meter) { return meter.value; }
function run(n) { const meter = new Meter(); let last = 0; for (let i = 0; i < n; i++) last = read(meter); return last; }
report(run(3));
function others(i) { if (i === 0) return new Uint8Array([4, 1]); return [4]; }
function both(n) { var out = ""; for (var i = 0; i < n; i++) { var op = others(i); if (op[0] === 4) out += "y"; else out += "n"; } return out; }
report(both(2));
function same(x) { return x; }
function last(n) { var kept = null; for (var i = 0; i < n; i++) kept = same(new Uint8Array([i, 1])); return kept[0]; }
report(last(3));
function parse(text) { return Number(text); }
function start(list) { for (var i = 0; i < list.length; i++) { var from = parse(list[i]); if (from < 0) continue; } return from; }
report(start(["1", "2"]));
function inner() { return new Meter().value; }
function outer() { return inner(); }
function nested(n) { let kept = 0; for (let i = 0; i < n; i++) kept = outer(); return kept; }
report(nested(2));
report("end");
