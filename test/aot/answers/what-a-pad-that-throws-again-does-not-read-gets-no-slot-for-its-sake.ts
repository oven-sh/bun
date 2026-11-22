// answers: with-library
// # A for-of closes its iterator where its body throws: a landing pad that catches, closes and throws again. Control never comes back from it,
// # so it can need only what is read in its own region. The sum and the place in the table merely lie across the pad's position in the order:
// # they were stored into the frame behind every definition, in every turn, for a pad that never reads them.
// # RUN(PADS): liveness-of-operations f1:Body mechanisms=all
// # REQUIRES(PADS): x86_64 as-written
// # PADS-COUNT-1: LivesIntoLandingPad
// # PADS-NOT: LivesIntoLandingPad
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function sum(s: Set<any>): any { let t: any = 0; for (const x of s) t += x; return t; }
(globalThis as any).kept = [sum];
const bomb = { valueOf(): number { throw new Error("valueOf"); } };
function tries(s: Set<any>): string { try { return "whole " + sum(s); } catch (error) { return "caught " + (error as Error).message; } }
report(tries(new Set([1])));
report(tries(new Set([1, 2, 3, 4.5])));
report(tries(new Set()));
report(tries(new Set([1, 2, bomb, 4])));
report(tries(new Set([bomb])));
report(tries(new Set(["a", 1, "b"])));
report("end");
