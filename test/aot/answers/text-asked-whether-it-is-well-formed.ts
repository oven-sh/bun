// answers: without-library
// # a flat text of narrow characters is well formed, and the stub says so; a wide text, a rope and every other receiver are served as before
// # f1 = sound: the site is the one of a call by name, and the stub that it calls bears the form
// # RUN(FORM): bytes f1:Body mechanisms=all
// # FORM: CallMethodOfBuiltinClass{{*}}StringIsWellFormed
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 25 of 25 of 25
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let calls = 0;
function sound(text: any) { const answer = text.isWellFormed(); calls++; return answer; }
function tried(f: () => unknown) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "another error"; } }
class Shelf { isWellFormed() { return "a shelf"; } }
const record = { isWellFormed: () => "a record" };
report(sound("plain"));
report(sound(""));
report(sound(new Shelf()));
report(sound(record));
report(sound("café"));
report(sound("Ā"));
report(sound("\ud800"));
report(sound("a\udc00b"));
report(sound("a😀"));
report(sound("\ude00\ud83d"));
let rope = "ab";
rope += String(calls);
rope += "cd";
report(sound(rope));
let wideRope = "\ud83d";
wideRope += String(calls);
report(sound(wideRope));
wideRope = "\ud83d";
wideRope += "\ude00";
report(sound(wideRope));
report(sound("a long text that is cut".slice(2, 11)));
report(sound(new String("boxed")));
report(sound(new String("\ud800")));
report(tried(() => sound(null)));
report(tried(() => sound(undefined)));
report(tried(() => sound(5)));
report(tried(() => sound({})));
report(tried(() => (String.prototype as any).isWellFormed.call(null)));
report((String.prototype as any).isWellFormed.call(12));
report((String.prototype as any).isWellFormed.call({ toString() { calls += 100; return "\udfff"; } }));
report(calls);
report("end");
