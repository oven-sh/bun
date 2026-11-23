// answers: without-library
// # An object that stays in its function is taken apart into values, and is made only on the way on which it leaves. Here it leaves now and then: into a list, by a throw, into a field out of a loop; and a field takes a value of another type.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 20 of 20 of 20
// # CHECK-NEXT: exited with 0
function held(value) { const made = { x: 1, y: 2 }; made.x = value; return made.x; }
report(held(5)); report(held("s")); report(held(undefined)); report(held(1.5));
function maybeKept(value, keep) { const made = { x: value, y: 2 }; if (keep) kept.push(made); made.y = value; return made.x + made.y; }
const kept = [];
report(maybeKept(1, false)); report(maybeKept(2, true)); report(kept.length + ":" + kept[0].y);
function pair(a, b) { return { first: a, second: b }; }
function sumOfPair(a, b) { const made = pair(a, b); return made.first + made.second; }
report(sumOfPair(1, 2)); report(sumOfPair("a", 2)); report(sumOfPair(1.5, undefined));
function thrown(value) { const made = { x: value }; try { if (value < 0) throw made; made.x = value + 1; } catch (caught) { return "caught " + caught.x; } return made.x; }
report(thrown(1)); report(thrown(-1));
function described(source, key) { return Object.getOwnPropertyDescriptor(source, key).value; }
function tried(source, key) { try { return described(source, key); } catch (error) { return error.name; } }
report(tried({ a: 1 }, "a")); report(tried({ a: 1 }, "b")); report(tried({ get a() { return 2; } }, "a"));
function inLoop(n) { let total = 0; for (let i = 0; i < n; i++) { const point = { x: i, y: i * 2 }; if (i === 3) last.point = point; total += point.x + point.y; } return total; }
const last = { point: null };
report(inLoop(3)); report(last.point === null); report(inLoop(5)); report(last.point.y);
report("end");
