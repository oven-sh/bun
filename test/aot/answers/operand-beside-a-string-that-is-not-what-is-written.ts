// answers: with-library
// # beside a string stands what is written as a number or a string and is neither: null, undefined, a boolean, a list, an object that converts (which of its functions runs, with which hint, how often, in which order beside a second one), one that throws, a BigInt, a symbol
// # the arm behind the test joins what has text by itself, the other arm does what is written, and the log and the error are those of the text as the shell runs it
// # f1 = label, f2 = before, f3 = doubled, f4 = pair, f5 = counted, f6 = rows, f7 = grown, f8 = noisy, f9 = hinted, f10 = tell
// # RUN(FORM): walk f1 mechanisms=all-ParameterGuards
// # FORM-LABEL: code f1:Body
// # FORM: = TypeTest
// # FORM: = Strcat
// # RUN(LEFT): walk f2 mechanisms=all-ParameterGuards
// # LEFT-LABEL: code f2:Body
// # LEFT: = TypeTest
// # RUN(BOTH): walk f4 mechanisms=all-ParameterGuards
// # BOTH-LABEL: code f4:Body
// # BOTH-COUNT-2: = TypeTest
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 141 of 141 of 141
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-ParameterGuards $SHELL
// # ALSO1: 141 of 141 of 141
// # ALSO1-NEXT: exited with 0
declare function report(value: unknown): void;
let log = "";
function label(x: number | string) { return "id-" + x + "!"; }
function before(x: number | string) { return x + "-id"; }
function doubled(x: number | string) { return "a" + x + "b" + x + "c"; }
function pair(x: number | string, y: number | string) { return "a" + x + "b" + y + "c"; }
function counted(x: number) { return "n=" + x; }
function rows(list: unknown[], n: number) { let last = ""; for (let i = 0; i < n; i++) last = "k" + list[i] + ";" + last.length; return last; }
function grown(list: unknown[], n: number) { let all = ""; for (let i = 0; i < n; i++) all += "k" + list[i] + ";"; return all; }
function noisy(name: string, text: unknown) { return { toString() { log += name + "s"; return text; }, valueOf() { log += name + "v"; return text; } }; }
function hinted(name: string) { return { [Symbol.toPrimitive](hint: string) { log += name + hint; return hint; } }; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report("caught " + (e as Error).name); } report(log); log = ""; }
const parsed = JSON.parse("[1,\"t\",null,true,-1.5,\"\",[1,2],{\"a\":1}]") as any[];
for (let i = 0; i < parsed.length; i++) tell(() => label(parsed[i]));
for (let i = 0; i < parsed.length; i++) tell(() => before(parsed[i]));
for (let i = 0; i < parsed.length; i++) tell(() => doubled(parsed[i]));
for (let i = 0; i < parsed.length; i++) tell(() => pair(parsed[i], parsed[parsed.length - 1 - i]));
for (let i = 0; i < parsed.length; i++) tell(() => counted(parsed[i]));
tell(() => label(-0));
tell(() => label(NaN));
tell(() => label(undefined as any));
tell(() => label(10n as any));
tell(() => label(Symbol("s") as any));
tell(() => label(noisy("x", "X") as any));
tell(() => label(noisy("x", 5) as any));
tell(() => label(noisy("x", {}) as any));
tell(() => label(hinted("h") as any));
tell(() => label({ valueOf() { log += "thrown"; throw new RangeError("no"); } } as any));
tell(() => before(noisy("x", "X") as any));
tell(() => before(hinted("h") as any));
tell(() => before(Symbol("s") as any));
tell(() => doubled(noisy("x", "X") as any));
tell(() => doubled(hinted("h") as any));
tell(() => pair(noisy("x", "X") as any, noisy("y", "Y") as any));
tell(() => pair(1, noisy("y", "Y") as any));
tell(() => pair(noisy("x", "X") as any, 2));
tell(() => pair(noisy("x", "X") as any, Symbol("s") as any));
tell(() => counted(noisy("x", 5) as any));
tell(() => rows(parsed, parsed.length));
tell(() => rows(parsed, parsed.length + 1));
tell(() => rows([noisy("a", "A"), 2, noisy("c", "C")], 3));
tell(() => rows([1, Symbol("s"), noisy("c", "C")], 3));
tell(() => rows([], 0));
tell(() => grown(parsed, parsed.length + 1));
tell(() => grown([noisy("a", "A"), 2, noisy("c", "C")], 3));
tell(() => grown([1, Symbol("s"), noisy("c", "C")], 3));
tell(() => grown([1, hinted("h"), 10n], 3));
tell(() => label(3));
report("end");
