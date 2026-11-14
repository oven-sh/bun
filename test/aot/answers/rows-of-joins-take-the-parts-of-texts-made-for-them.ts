// answers: without-library
// # a number that goes into a template unconverted, an operator on numbers inside a row, and the join of a copied callee whose parts go into the row of the caller give the texts that the conversions and joins as written give: -0, NaN, the infinities, exponents, integers beyond 32 and 53 bits
// # where a part may run code nothing is moved: the log holds which conversion ran, in which order, and where a throw ended the row
// # f8 = px, f9 = flagged, f10 = absent, f11 = cell, f12 = scaled, f1 = tag, f13 = line, f14 = lines, f15 = both, f2 = named, f16 = title, f17 = cast, f3 = late, f4 = any, f5 = order, f6 = between, f7 = noisy, f18 = tell
// # RUN(FORM): walk f8 mechanisms=all
// # FORM-LABEL: code f8:Body
// # FORM: = Strcat
// # RUN(UNCONVERTED): walk f8 mechanisms=all
// # UNCONVERTED-NOT: = ToString
// # RUN(COPIED): walk f13 mechanisms=all
// # COPIED-LABEL: code f13:Body
// # COPIED-COUNT-1: = Strcat
// # COPIED-NOT: = Strcat
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 73 of 73 of 73
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 73 of 73 of 73
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function px(n: number) { return `${n}px`; }
function flagged(x: number) { return `${x === 2}!`; }
function absent(x: null | undefined | boolean) { return `${x}-${x}`; }
function cell(name: string, i: number) { return name + "[" + (i + 1) + "]"; }
function scaled(name: string, i: number) { return name + ":" + i * 2 + ":" + (i - 1) + ":" + -i + ":" + (i < 3) + ":" + i / 0; }
function tag(n: number) { return "[" + n + "]"; }
function line(n: number) { return "<" + tag(n) + ">"; }
function lines(n: number) { let all = ""; for (let i = 0; i < n; i++) all += "<" + tag(i * 0.5) + ">"; return all; }
function both(n: number) { const text = tag(n); return "<" + text + ">" + text; }
function named(name: string) { return "[" + name + "]"; }
function title(name: string) { return "<" + named(name) + ">"; }
function cast(a: string, n: number) { return ((a + n) as string) + "!"; }
function late(n: number, f: () => void) { const text = `${n}`; f(); return text + "px"; }
function any(x: unknown) { return `${x}px`; }
function order(a: unknown, b: unknown) { return "<" + a + "|" + b + ">"; }
function between(name: string, x: unknown) { return name + "[" + ((x as number) + 1) + "]"; }
function noisy(name: string, text: unknown) { return { toString() { log += name + "s"; return text; }, valueOf() { log += name + "v"; return text; } }; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report("caught " + (e as Error).name); } report(log); log = ""; }
report(px(0));
report(px(-0));
report(px(1.5));
report(px(NaN));
report(px(-Infinity));
report(px(1e21));
report(px(1e-7));
report(px(4294967296));
report(flagged(2));
report(flagged(3));
report(absent(null));
report(absent(undefined));
report(absent(false));
report(cell("a", 0));
report(cell("", -1));
report(cell("Ā", 2147483647));
report(cell("a", 0.5));
report(cell("a", NaN));
report(cell("a", 9007199254740992));
report(scaled("s", 0));
report(scaled("s", -0));
report(scaled("s", 4));
report(scaled("s", NaN));
report(line(7));
report(line(-0));
report(line(0.25));
report(lines(0));
report(lines(5));
report(both(3));
report(title(""));
report(title("n"));
report(title(lines(3)));
report(cast("a", 1));
report(cast("", -0));
tell(() => late(5, () => { log += "called"; }));
tell(() => late(5, () => { throw new TypeError("late"); }));
tell(() => any(3));
tell(() => any("t"));
tell(() => any(null));
tell(() => any(10n));
tell(() => any(noisy("a", "A")));
tell(() => any(noisy("a", 4)));
tell(() => any(Symbol("s")));
tell(() => any({ toString() { log += "thrown"; throw new RangeError("no"); } }));
tell(() => order(noisy("a", "A"), noisy("b", "B")));
tell(() => order(1, noisy("b", "B")));
tell(() => order(noisy("a", "A"), Symbol("s")));
tell(() => between("n", 1));
tell(() => between("n", "1"));
tell(() => between("n", noisy("x", 4)));
tell(() => between("n", noisy("x", "4")));
tell(() => between("n", 4n));
tell(() => between("n", Symbol("s")));
report("end");
