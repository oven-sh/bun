// answers: with-library
// # indexOf, lastIndexOf and startsWith with a position go by the stub of String where the position is an int32, inside the text or not; every other position, operand and receiver is served as before
// # f1 = found, f2 = foundLast, f3 = began: the site is the one of a call by name, and the stub that it calls bears the form and the count
// # RUN(FOUND): bytes f1:Body mechanisms=all
// # FOUND: CallMethodOfBuiltinClass{{*}}StringIndexOf count 2
// # RUN(LAST): bytes f2:Body mechanisms=all
// # LAST: CallMethodOfBuiltinClass{{*}}StringLastIndexOf count 2
// # RUN(BEGAN): bytes f3:Body mechanisms=all
// # BEGAN: CallMethodOfBuiltinClass{{*}}StringStartsWith count 2
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 103 of 103 of 103
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
let calls = 0;
function found(text: any, part: any, from: any) { const place = text.indexOf(part, from); calls++; return place; }
function foundLast(text: any, part: any, from: any) { const place = text.lastIndexOf(part, from); calls++; return place; }
function began(text: any, part: any, from: any) { const answer = text.startsWith(part, from); calls++; return answer; }
function tried(f: () => unknown) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "another error"; } }
class Shelf { indexOf(part: any, from: any) { return "shelf " + part + from; } lastIndexOf(part: any, from: any) { return "shelf last " + part + from; } startsWith(part: any, from: any) { return "shelf starts " + part + from; } }
const record = { indexOf: () => "a record", lastIndexOf: () => "a record", startsWith: () => "a record" };
const shelf = new Shelf();
const text = "abcabc";
report(found(text, "c", 0));
report(found(shelf, "c", 0));
report(found(record, "c", 0));
report(found(text, "c", 3));
report(found(text, "c", 5));
report(found(text, "c", 6));
report(found(text, "c", 7));
report(found(text, "c", -1));
report(found(text, "c", -100));
report(found(text, "c", 2147483647));
report(found(text, "c", -2147483648));
report(found(text, "bc", 2));
report(found(text, "", 2));
report(found(text, "", 6));
report(found(text, "", 10));
report(found(text, "", -10));
report(found("", "", 3));
report(found("", "a", 0));
report(found(text, "c", 2.9));
report(found(text, "c", NaN));
report(found(text, "c", Infinity));
report(found(text, "c", -Infinity));
report(found(text, "c", -0));
report(found(text, "c", "3"));
report(found(text, "c", null));
report(found(text, "c", undefined));
report(found(text, "c", true));
report(found(text, "c", 4294967299));
report(found(text, "c", { valueOf() { calls += 100; return 3; } }));
report(found(text, { toString() { calls += 1000; return "c"; } }, { valueOf() { calls += 10000; return 3; } }));
report(calls);
report(found("12312", 2, 2));
report(found("a null", null, 1));
report(found("kůň kůň", "ů", 2));
report(found("kůň kun", "k", 1));
report(found("narrow", "ů", 1));
let rope = "abc";
rope += String(calls);
rope += "abc";
report(found(rope, "abc", 1));
report(found(rope, "abc", 100));
let part = "b";
part += "c";
report(found(text, part, 2));
report(found([1, 2, 1], 1, 1));
report(found([1, 2, 1], 1, -1));
report(found(new String("abcabc"), "c", 3));
report(tried(() => found(null, "c", 0)));
report(tried(() => found(undefined, "c", 0)));
report(tried(() => found(5, "c", 0)));
report(tried(() => found(text, Symbol("no text"), 0)));
report(tried(() => found(text, "c", Symbol("no number"))));
report(tried(() => found(text, "c", 1n)));
report(foundLast(text, "c", 5));
report(foundLast(shelf, "c", 5));
report(foundLast(record, "c", 5));
report(foundLast(text, "c", 4));
report(foundLast(text, "c", 2));
report(foundLast(text, "c", 1));
report(foundLast(text, "c", 0));
report(foundLast(text, "c", -1));
report(foundLast(text, "a", -1));
report(foundLast(text, "c", 100));
report(foundLast(text, "c", 2147483647));
report(foundLast(text, "a", -2147483648));
report(foundLast(text, "bc", 4));
report(foundLast(text, "bc", 3));
report(foundLast(text, "", 2));
report(foundLast(text, "", 10));
report(foundLast(text, "", -10));
report(foundLast("", "", 3));
report(foundLast(text, "abcabcabc", 3));
report(foundLast(text, "c", NaN));
report(foundLast(text, "c", 2.9));
report(foundLast(text, "c", undefined));
report(foundLast(text, "c", null));
report(foundLast(text, "c", "2"));
report(foundLast(rope, "abc", 2));
report(foundLast("kůň kůň", "ů", 4));
report(foundLast([1, 2, 1], 1, 1));
report(tried(() => foundLast(null, "c", 0)));
report(began(text, "c", 2));
report(began(shelf, "c", 2));
report(began(record, "c", 2));
report(began(text, "c", 3));
report(began(text, "abc", 3));
report(began(text, "abc", 4));
report(began(text, "a", -1));
report(began(text, "a", -2147483648));
report(began(text, "b", -1));
report(began(text, "", 6));
report(began(text, "", 10));
report(began(text, "", 2147483647));
report(began(text, "c", 5));
report(began(text, "c", 6));
report(began(text, "cc", 5));
report(began("", "", 0));
report(began(text, "a", NaN));
report(began(text, "c", 2.9));
report(began(text, "a", undefined));
report(began(text, "c", "2"));
report(began(rope, "bc", 1));
report(began("kůň", "ů", 1));
report(began("kůň", "u", 1));
report(tried(() => began(text, /a/, 0)));
report(tried(() => began(null, "a", 0)));
report(calls);
report("end");
