// answers: with-library
// # The allocator gives a slot to a value that it lets go of while the value's range goes on, and the store stands behind the definition.
// # Where no way that follows asks for the value again, no step reads the slot: here the place where a stretch of weights begins, which each laid-out turn of the loop
// # hands on unchanged and defines anew. Such a slot is not written.
// # f2 = stretches, f3 = longest
// # RUN(SLOTS): allocate f2:Body mechanisms=all
// # REQUIRES(SLOTS): x86_64 as-written
// # SLOTS: isDeadSlot
// # RUN(OTHERS): allocate f3:Body mechanisms=all
// # REQUIRES(OTHERS): x86_64 as-written
// # OTHERS: isDeadSlot
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function stretches(weights: number[]): number[] { const out: number[] = []; let from = 0; for (let i = 0; i < weights.length; i++) { const weight = weights[i]; if (weight < 0) { out.push(i - from); from = i + 1; } else if (weight > 1000) out.push(-from); } out.push(weights.length - from); return out; }
function longest(weights: number[], limit: number): number { let best = 0; let from = 0; let bestFrom = 0; let sum = 0; for (let i = 0; i < weights.length; i++) { sum += weights[i]; if (weights[i] > limit) { if (i - from > best) { best = i - from; bestFrom = from; } from = i + 1; sum = 0; } } return best * 100 + bestFrom + sum; }
report(stretches(id([1, 2, -1, 3, 2000, -5, 7])).join());
report(stretches(id([])).join());
report(stretches(id([-1, -2, -3])).join());
report(stretches(id([0.5, 1001, -0.5, NaN, Infinity, -Infinity])).join());
report(longest(id([1, 2, 9, 3, 4, 5, 9, 1]), id(6)));
report(longest(id([]), id(1)));
report(longest(id([0.5, 7.5, 1, 1, 1, 1, 8, 2]), id(7)));
for (let turn = 0; turn < 1; turn++) report(stretches(id([3, 4, 5, -1, 5000, 1, 1, 1, 1, 1, 1, 1, -2, 6])).join() + longest(id([1, 1, 1, 1, 1, 1, 1, 1, 1, 9, 1]), id(3)));
report("end");
