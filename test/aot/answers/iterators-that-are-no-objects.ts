// answers: with-library
// # A spread asks whatever the method under @@iterator answers for next, a number too. A pattern and for-of take an object alone.
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 25 of 25 of 25
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function attempt(run: () => unknown): void { try { report(String(run())); } catch (error: any) { report(String(error)); } }
function spread(items: any): string { return "[" + [...items].join() + "]"; }
function behind(items: any): string { return "[" + [0, ...items, 9].join() + "]"; }
function count(...values: any[]): string { return values.length + ":" + values.join(); }
function passed(items: any): string { return count(...items); }
function one(items: any): string { const [a] = items; return String(a); }
function two(items: any): string { const [a, b] = items; return a + "/" + b; }
function none(items: any): string { const [] = items; return "no step"; }
function walked(items: any): string { let s = ""; for (const each of items) s += each + ";"; return s; }
function left(items: any): string { for (const each of items) return "left at " + each; return "nothing"; }
const ways = [spread, behind, passed, one, two, none, walked, left];
function all(items: any): void { for (const way of ways) attempt(() => way(items)); }

let steps = 0;
const number = { [Symbol.iterator]() { steps = 0; return 5; } };
const text = { [Symbol.iterator]() { steps = 0; return "text"; } };
const truth = { [Symbol.iterator]() { steps = 0; return true; } };
all(number);
all(text);

all(truth);
report("end");
