// answers: without-library
// # A list literal is expected to hold numbers and one element is whatever the caller hands over. The loops ask `at in list`, compare an element with undefined and with null, read past the end, store into the list and cut it short: an element that is there and is no number goes the way of an element, never the way of a gap.
// # At the end the shell runs the same text itself: every answer is the same.
// # Where a guess about a list fails, `for of` goes by the protocol and calls `next` of the iterators of arrays, which is a function of the library. So the text brings that function.
// # Without mechanisms the program runs built-ins that are written in JavaScript. They are the engine's own here, and no stand-in answers for them.
// # LIBRARY: own
// # RUN: run-in-shell $SHELL
// # CHECK: 50 of 50 of 50
// # CHECK-NEXT: exited with 0
function asked(x) { const list = [1.5, x, 2.5]; let sum = 0; for (let at = 0; at < 4; at++) { if (at in list) sum += list[at]; else sum += 100; } return sum; }
function askedOfGaps(x) { const list = [1.5, , x]; let said = ""; for (let at = 0; at < 4; at++) said += (at in list ? "in" : "out") + list[at] + ","; return said; }
function undefinedOnes(x) { const list = [1.5, x, 2.5]; let count = 0; for (let at = 0; at < list.length; at++) if (list[at] === undefined) count++; return count; }
function nullOnes(x) { const list = [1.5, x, 2.5]; let count = 0; for (let at = 0; at < list.length; at++) if (list[at] === null) count++; return count; }
function pastTheEnd(x) { const list = [1.5, x]; let sum = 0; for (let at = 0; at <= list.length; at++) sum += list[at] === undefined ? 1000 : list[at]; return sum; }
function storedThenRead(x) { const list = [1.5, 2.5, 3.5]; let sum = 0; for (let at = 0; at < list.length; at++) { if (at === 1) list[2] = x; sum += list[at]; } return sum; }
function shortened(x) { const list = [1.5, 2.5, 3.5, x]; let sum = 0; for (let at = 0; at < 4; at++) { if (at === 1) list.length = 2; sum += at in list ? list[at] : 10; } return sum; }
for (const run of [asked, askedOfGaps, undefinedOnes, nullOnes, pastTheEnd, storedThenRead, shortened]) { report(run(4.5)); report(run(7)); report(run()); report(run(null)); report(run("a")); report(run(NaN)); report(run(-0)); }
report("end");
