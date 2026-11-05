// answers: without-library
// # the Straight emitter lets a value wait in the result register for the next operation that gets code. `smaller = null` on a local is a ReleaseHint, which gets none: the answer of the comparison went on waiting, dead, and the read of a module variable and the test for a number wrote the register without storing it; the define behind them then brought the dead 0 | 1 into its boxed form over the new value: 5 read as true, every value was a number, a text's pointer was broken.
// # variable, kind and texts are handed an object that is not of their parameter's class, so their slow versions run, which are written straight.
// # x
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
const shown: any = unseen(5);
const text: any = unseen("a text");
function main() { function variable(tag: Tag): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let smaller: boolean | null = tag.n < work; smaller = null; const out = shown; if (smaller !== null) return 0; return out; } function kind(tag: Tag, value: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let smaller: boolean | null = tag.n < work; smaller = null; if (typeof value === "number") return "number"; return smaller === null ? "other" : "none"; } function texts(tag: Tag): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let first: boolean | undefined = tag.m >= work; first = undefined; const one = text; return one + "!"; } const real = new Tag(); for (let turn = 0; turn < 300; turn++) { variable(real); kind(real, "x"); texts(real); } report(variable(real)); report(kind(real, "x")); report(kind(real, 7)); report(texts(real)); const liar = unseen({ n: 1, m: 2 }); report(variable(liar)); report(kind(liar, "x")); report(kind(liar, 7)); report(texts(liar)); }
main();
report("end");
declare function report(value: unknown): void;
