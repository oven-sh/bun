// answers: without-library
// # a part that runs code to give its text: the hint, the order of the conversions, how often each runs, what is thrown and when
// # f1 = named, f2 = hinted, f3 = failing, f4 = sums, f5 = templates, f6 = rowsOf, f7 = pairs, f8 = tell
// # RUN(FORM): walk f4 mechanisms=all
// # FORM-LABEL: code f4:Body
// # FORM: StringBuilderBegin
// # RUN(BOTH): walk f5 mechanisms=all
// # BOTH-LABEL: code f5:Body
// # BOTH: StringBuilderBegin
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 43 of 43 of 43
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 43 of 43 of 43
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function named(name: string, text: unknown) { return { toString() { log += name + "s"; return text; }, valueOf() { log += name + "v"; return text; } }; }
function hinted(name: string) { return { [Symbol.toPrimitive](hint: string) { log += name + hint[0]; return name; } }; }
function failing(at: number) { let calls = 0; return { toString() { if (++calls === at) throw "stop" + calls; return "t" + calls; } }; }
function sums(x: any, n: number) { let out = ""; for (let i = 0; i < n; i++) out += x; return out; }
function templates(x: any, y: any, n: number) { let out = ""; for (let i = 0; i < n; i++) out = `${out}${x}${y}`; return out; }
function rowsOf(x: any, y: any, n: number) { let out = ""; for (let i = 0; i < n; i++) out += "<" + x + "|" + y + ">"; return out; }
function pairs(x: any, y: any, n: number) { let out = "p"; for (let i = 0; i < n; i++) { out += x; out += y; } return out; }
function tell(f: () => unknown) { log = ""; try { report(f()); } catch (e) { report("threw " + (typeof e === "string" ? e : (e as Error).name)); } report(log); }
tell(() => sums("a", 3));
tell(() => sums(2, 3));
tell(() => sums(-0, 2));
tell(() => sums(null, 2));
tell(() => sums(undefined, 2));
tell(() => sums(true, 2));
tell(() => sums(10n, 2));
tell(() => sums(named("n", "N"), 3));
tell(() => sums(named("m", 7), 2));
tell(() => sums(hinted("h"), 3));
tell(() => sums(failing(3), 5));
tell(() => sums(Symbol("no"), 2));
tell(() => sums(Symbol("never"), 0));
tell(() => templates(named("a", "A"), named("b", "B"), 2));
tell(() => templates(hinted("x"), hinted("y"), 2));
tell(() => templates(named("a", "A"), failing(2), 3));
tell(() => templates(failing(2), named("b", "B"), 3));
tell(() => templates(1, Symbol("no"), 1));
tell(() => rowsOf(named("a", "A"), hinted("y"), 2));
tell(() => pairs(named("a", "A"), failing(2), 3));
tell(() => pairs(hinted("x"), 1.5, 2));
report("end");
