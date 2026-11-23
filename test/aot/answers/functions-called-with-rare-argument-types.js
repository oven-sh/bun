// answers: without-library
// # Functions are copied into their callers, split by the kinds of their operands and turned into loops on what the callers mostly pass. Here each also gets a record in another order, without a member, a text for a list, a built-in for a closure.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
function scale(point, by) { return point.x * by + point.y; }
report(scale({ x: 1, y: 2 }, 3)); report(scale({ x: 1.5, y: 2 }, 2)); report(scale({ y: 2, x: 1 }, 3)); report(scale({ x: "a", y: 2 }, 3)); report(scale({ x: 1 }, 3));
function outer(point) { return scale(point, 2) + scale(point, 3); }
report(outer({ x: 1, y: 2 })); report(outer({ x: 1, y: "z" }));
function pickFirst(list) { return list[0]; }
function both(list) { return pickFirst(list) + pickFirst(list); }
report(both([1, 2])); report(both(["a"])); report(both([])); report(both("xy"));
function apply(run, value) { return run(value); }
report(apply(value => value + 1, 1)); report(apply(value => value + "!", "a")); report(apply(String, 5)); report(apply(Math.abs, -5));
function recursive(n, total) { return n === 0 ? total : recursive(n - 1, total + n); }
report(recursive(10, 0)); report(recursive(3, "t")); report(recursive(3, 0.5));
report("end");
