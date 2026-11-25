// answers: with-library
// # the row of replace that takes a RegExp refuses undefined and null in its place and takes the object only as its class makes it. So a pattern that is written as a RegExp or nothing is tested for its class, its cell is looked at, and behind the two the call goes by that row. For null, undefined, a RegExp with an exec of its own and an object of a subclass the call is made as it is written
// # the library rides along: a RegExp that is not as it was made is asked by the protocol, which is written in JavaScript
// # f1 = strip, f2 = once, f3 = stripBySubclass, f4 = tell
// # RUN(FORM): walk f1 mechanisms=all
// # FORM-LABEL: code f1:Body
// # FORM: = TypeTest
// # FORM: = IsPristine {{*}}builtinClass=RegExp
// # FORM: frequency=Rare
// # FORM: : string @{{*}}overload=StringPrototypeReplace
// # RUN(ONCE): walk f2 mechanisms=all
// # ONCE-LABEL: code f2:Body
// # ONCE: = TypeTest
// # ONCE: = IsPristine {{*}}builtinClass=RegExp
// # ONCE: frequency=Rare
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function strip(text: string, pattern: RegExp | null, n: number) { let out = ""; for (let i = 0; i < n; i++) out = text.replace(pattern as RegExp, "-"); return out; }
function once(text: string, pattern?: RegExp) { return text.replace(pattern!, "+"); }
function stripBySubclass(text: string, pattern: RegExp | null, n: number) { let out = ""; for (let i = 0; i < n; i++) out = text.replace(pattern as RegExp, "-"); return out; }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
class Loud extends RegExp { [Symbol.replace](text: string, replacement: any) { return "loud " + text + replacement; } }
let log = "";
const odd = /b/;
(odd as any).exec = function () { log += "e"; return null; };
report(strip("abcb", /b/, 2));
report(strip("abcb", /b/g, 2));
report(strip("a null b", null, 2));
tell(() => strip("abcb", odd, 2) + log);
const sticky = /b/y;
sticky.lastIndex = 1;
report(strip("abb", sticky, 2) + "|" + sticky.lastIndex);
report(strip("abb", sticky, 1) + "|" + sticky.lastIndex);
report(strip("abcb", /(b)(c)?/, 1));
report(strip("", /^/, 3));
report(strip("abcb", /b/, 0));
report(once("abcb", /c/));
report(once("a undefined b"));
report(once("a undefined b", undefined));
tell(() => once("abcb", odd) + log);
tell(() => stripBySubclass("abcb", new Loud("b"), 2));
tell(() => stripBySubclass("abcb", /b/, 2));
tell(() => stripBySubclass("a null b", null, 2));
report("end");
