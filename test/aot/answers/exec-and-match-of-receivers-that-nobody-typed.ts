// answers: with-library
// # exec and match under receivers that nobody typed go by the stubs of RegExp and of String; every other receiver, a RegExp that was touched and an operand of another kind are served as before
// # f1 = shown, f2 = ran, f3 = matched: the site is the one of a call by name, and the stub that it calls bears the form
// # RUN(EXEC): bytes f2:Body mechanisms=all
// # REQUIRES(EXEC): entries-of-bun
// # EXEC: CallMethodOfBuiltinClass{{*}}RegExpExec count 1
// # RUN(MATCH): bytes f3:Body mechanisms=all
// # REQUIRES(MATCH): entries-of-bun
// # MATCH: CallMethodOfBuiltinClass{{*}}StringMatch count 1
// # RUN(NAMED): walk f2 mechanisms=all
// # REQUIRES(NAMED): entries-of-bun
// # NAMED: = Call {{*}}calleeKey="exec" {{*}}methodOfReceiverAsMade=RegExpPrototypeExec
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 68 of 68 of 68
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let calls = 0;
function shown(found: any) { return found === null ? "null" : typeof found === "object" ? found.join("|") + "@" + found.index : String(found); }
function ran(pattern: any, text: any) { const found = pattern.exec(text); calls++; return shown(found); }
function matched(text: any, pattern: any) { const found = text.match(pattern); calls++; return shown(found); }
function tried(f: () => unknown) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "another error"; } }
class Loud extends RegExp { exec(text: string) { const found = super.exec(text); if (found) found[0] = found[0].toUpperCase(); return found; } }
class Shelf { exec(text: string) { return "shelf runs " + text; } match(pattern: unknown) { return "shelf matches " + String(pattern); } }
const record = { exec: (text: string) => "record runs " + text, match: () => "record matches" };
const shelf = new Shelf();
const word = /(\w)(\w+)/;
report(ran(word, "hello world"));
report(ran(word, "!!"));
report(ran(shelf, "a"));
report(ran(record, "a"));
report(ran(word, "again here"));
report(ran(/(a)|(b)/, "b"));
report(ran(/ů/, "kůň"));
const all = /o/g;
report(ran(all, "foo boo"));
report(all.lastIndex);
report(ran(all, "foo boo"));
report(all.lastIndex);
all.lastIndex = 6;
report(ran(all, "foo boo"));
report(ran(all, "foo boo"));
report(all.lastIndex);
const sticky = /a/y;
report(ran(sticky, "aab"));
report(ran(sticky, "aab"));
report(ran(sticky, "aab"));
report(sticky.lastIndex);
(all as any).lastIndex = { valueOf() { calls += 100; return 3; } };
report(ran(all, "foo boo"));
report(calls);
const locked = /a/g;
Object.defineProperty(locked, "lastIndex", { writable: false });
report(tried(() => ran(locked, "aaa")));
report(locked.lastIndex);
const own = /a/;
report(ran(own, "a"));
(own as any).exec = () => "own exec";
report(ran(own, "a"));
delete (own as any).exec;
report(ran(own, "a"));
report(ran(new Loud("b+"), "abbc"));
const moved = /a/;
Object.setPrototypeOf(moved, { exec() { return "moved"; } });
report(ran(moved, "a"));
report(ran(word, 12345));
report(ran(word, null));
report(ran(word, undefined));
report(ran(word, { toString() { calls += 1000; return "an object"; } }));
report(calls);
let rope = "x";
rope += "yz";
rope += String(calls);
report(ran(/z(\d)/, rope));
report(tried(() => ran(null, "a")));
report(tried(() => ran(undefined, "a")));
report(tried(() => ran(5, "a")));
report(tried(() => ran("text", "a")));
report(tried(() => ran({}, "a")));
report(tried(() => ran(word, Symbol("no text"))));
report(tried(() => (RegExp.prototype.exec as any).call({}, "a")));
report(matched("hello world", word));
report(matched("!!", word));
report(matched(shelf, word));
report(matched(record, word));
report(matched("foo boo", /o/g));
report(matched("foo boo", /x/g));
report(matched("kůň", /ů/));
report(matched(rope, /z(\d)/));
report(matched("a.b", "."));
report(matched("abc", undefined));
report(matched("null", null));
report(matched("a1b", 1));
const custom = /a/;
report(matched("a", custom));
(custom as any)[Symbol.match] = () => "a match of its own";
report(matched("a", custom));
report(matched("text", { [Symbol.match](text: string) { return "an object matches " + text; } }));
report(matched("abbc", new Loud("b+")));
report(matched("abbcbb", new Loud("b+", "g")));
report(matched(new String("boxed"), /x/));
report(matched("aab", sticky));
report(sticky.lastIndex);
report(tried(() => matched("aaa", locked)));
report(tried(() => matched(12321, /2/)));
report(tried(() => matched(null, /2/)));
report(tried(() => matched(undefined, /2/)));
report(tried(() => matched("a", Symbol("no pattern"))));
report(tried(() => matched("(", "(")));
report(calls);
report("end");
