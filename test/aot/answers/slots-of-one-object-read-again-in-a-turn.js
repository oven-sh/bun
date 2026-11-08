// answers: with-library
// # each mention of a slot in a turn is a read of its own, and what a test shows of the first holds of the later ones only while nothing was written: an accessor that counts its reads, a store through another name of the same object, a store and a call between two reads, the text swapped in a turn, a frozen object, a slot that was deleted, a text that is no text, a position that is a fraction, negative, NaN, a text, a bigint, or at the end of int32
// # f2 = count
// # RUN(FORM): walk f2 mechanisms=all
// # REQUIRES(FORM): entries-of-bun
// # FORM-LABEL: code f2:Body
// # FORM: isLoopHead=true
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 53 of 53 of 53
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-LoopInvariants $SHELL
// # REQUIRES(ALSO1): entries-of-bun
// # ALSO1: 53 of 53 of 53
// # ALSO1-NEXT: exited with 0
function make(text) { return { text, position: 0 }; }
function count(cursor) { let spaces = 0; for (cursor.position = 0; cursor.position < cursor.text.length; cursor.position++) if (cursor.text.charCodeAt(cursor.position) === 32) spaces++; return spaces; }
function countFrom(cursor, start) { let sum = 0; let turns = 0; for (cursor.position = start; cursor.position < cursor.text.length && turns < 9; cursor.position++) { sum += cursor.text.charCodeAt(cursor.position); turns++; } return sum + ":" + turns + ":" + cursor.position; }
function throughOtherName(cursor, other) { let seen = 0; for (cursor.position = 0; cursor.position < cursor.text.length; cursor.position++) { if (cursor.text.charCodeAt(cursor.position) === 32) other.position++; seen++; } return seen + ":" + cursor.position + ":" + other.position; }
function swapsText(cursor, next) { let codes = 0; for (cursor.position = 0; cursor.position < cursor.text.length; cursor.position++) { codes += cursor.text.charCodeAt(cursor.position); if (cursor.position === 1) cursor.text = next; } return codes; }
function storesBetweenReads(cursor) { let sum = 0; for (cursor.position = 0; cursor.position < cursor.text.length; cursor.position++) { const before = cursor.position; cursor.position = before + 1; sum += cursor.position * 10 + before; } return sum; }
function callsBetweenReads(cursor, step) { let sum = 0; for (cursor.position = 0; cursor.position < cursor.text.length; cursor.position++) { const before = cursor.position; step(cursor); sum += cursor.position * 10 + before; } return sum; }
function rope(n) { let text = "a"; for (let i = 0; i < n; i++) text = text + " b"; return text; }
function withAccessor(text) { const cursor = { text, held: 0, reads: 0 }; Object.defineProperty(cursor, "position", { get() { this.reads++; return this.held; }, set(value) { this.held = value; } }); return cursor; }
function tell(f) { try { report(f()); } catch (e) { report(e.constructor.name); } }
function round() { tell(() => count(make("a b c"))); tell(() => count(make(""))); tell(() => count(make(rope(5)))); tell(() => count(make("中 文 "))); tell(() => count(Object.freeze(make("a b")))); tell(() => { const cursor = make("a b"); delete cursor.position; return count(cursor) + ":" + cursor.position; }); tell(() => { const cursor = make("a b"); cursor.text = 5; return count(cursor); }); tell(() => { const cursor = make("a b"); cursor.text = null; return count(cursor); }); tell(() => { const cursor = make("a b"); cursor.text = ["x", " "]; return count(cursor); }); tell(() => { const cursor = withAccessor("a b "); return count(cursor) + ":" + cursor.reads; }); tell(() => count({ position: "0", text: "a b" })); tell(() => countFrom(make("abc"), 0.5)); tell(() => countFrom(make("abc"), -1)); tell(() => countFrom(make("abc"), NaN)); tell(() => countFrom(make("abc"), "1")); tell(() => countFrom(make("abc"), 2147483647)); tell(() => countFrom(make("abc"), -0)); tell(() => countFrom(make("abc"), undefined)); tell(() => countFrom(make("abc"), 1n)); tell(() => { const cursor = make("a b c"); return throughOtherName(cursor, cursor); }); tell(() => throughOtherName(make("a b c"), make(""))); tell(() => swapsText(make("abcd"), "xy")); tell(() => swapsText(make("abcd"), "xyzuvw")); tell(() => storesBetweenReads(make("abcde"))); tell(() => callsBetweenReads(make("abcde"), cursor => { cursor.position += 1; })); tell(() => callsBetweenReads(make("abcde"), cursor => { cursor.text = "ab"; })); }
round();
round();
report("end");
