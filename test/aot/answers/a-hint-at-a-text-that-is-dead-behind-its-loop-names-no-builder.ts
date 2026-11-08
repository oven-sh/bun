// answers: without-library
// # A release hint is the one operation that mentions a value that is dead. Behind the loop of a text in a builder the text's name is bound anew only where it is live,
// # so `c = next; c = undefined` hints at a name that still finds the builder's record: the hint is dropped by the type of what it names (the verifier stopped the build under the checks of proofs).
// # OPTIONS: check=Validate testing=CheckProofsAtRunTime
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 5 of 5 of 5
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function overKeys(other: any): unknown { let c: any = 0; { let next: any = 0; for (const k in other) next = next + k; c = next; } c = undefined; return [c].length; }
function overList(list: string[]): unknown { let c: any = 0; { let next = ""; for (let i = 0; i < list.length; i++) next += list[i]; c = next; } c = undefined; return [c].length; }
function readOnce(other: any): unknown { let c: any = 0; { let next: any = 0; for (const k in other) next = next + k; c = next; } const kept = c; c = undefined; return kept; }
report(overKeys(id({ p: 1, q: 2 })));
report(overList(id(["x", "y"])));
report(readOnce(id({ p: 1, q: 2 })));
report(readOnce(id({})));
report("end");
