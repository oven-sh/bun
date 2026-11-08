// answers: with-library
// # the list that split() makes of written texts: its pieces at the edges, with a limit, with the empty separator; it is changed, and made again
// # the library rides along: split is written in JavaScript, and a stand-in for it would answer undefined in the shell's run alone
// # where both texts are written at the call the front end lays the list down itself (`Data .. encoding=CopyOnWriteArray`). cut() gets its two from its one caller: that call goes by its row
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 14 of 14 of 14
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function colors() { return "red,green,blue".split(","); }
function edges() { return ",a,,b,".split(","); }
function none() { return "abc".split("x"); }
function ofEmpty() { return "".split(","); }
function longSeparator() { return "a--b".split("--"); }
function limited() { return "a,b".split(",", 1); }
function characters() { return "ab".split(""); }
function cut(text: string, at: string) { return text.split(at); }
function broughtTogether() { return cut("one,two", ","); }
function show(list: string[]) { let line = list.length + ":"; for (let i = 0; i < list.length; i++) line += "[" + list[i] + "]"; return line; }
function changed() { const first = colors(); const second = colors(); first.push("black"); (first as unknown[])[0] = 1.5; second.length = 1; return (first === second) + " " + show(first) + " " + show(second) + " " + show(colors()); }
function changedBehindCopy() { const first = broughtTogether(); const second = broughtTogether(); first.push("three"); second.length = 1; return (first === second) + " " + show(first) + " " + show(second) + " " + show(broughtTogether()); }
report(show(colors()));
report(show(edges()));
report(show(none()));
report(show(ofEmpty()));
report(show(longSeparator()));
report(show(limited()));
report(show(characters()));
report(show(broughtTogether()));
report(changed());
report(changed());
report(changedBehindCopy());
report(changedBehindCopy());
report(Array.isArray(colors()));
report("end");
