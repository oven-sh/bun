// answers: without-library
// # a fresh object that enters a loop in a parameter of the head has a second name there: what the turns store through it is there under the first name behind the loop
// # f1 = sum: the read behind the loop is a read
// # RUN(FORM): walk f1 mechanisms=all-Inlining
// # FORM-LABEL: code f1:Body
// # FORM: [[made]]: {{*}} = NewObject
// # FORM: PutSlot {{*}}key="n"
// # FORM: [[read]]: {{*}} = GetSlot [[made]] key="n"
// # FORM-NEXT: Return [[read]]
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 10 of 10 of 10
// # CHECK-NEXT: exited with 0
function sum(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n = (k.n + i) | 0; k = k; } return acc.n; }
function swapped(n) { const a = { n: 0 }, b = { n: 100 }; let p = a, q = b; for (let i = 0; i < n; i++) { p.n += i; const t = p; p = q; q = t; } return a.n + ":" + b.n; }
function leftByBreak(n) { const acc = { n: 0 }; let k = acc, i = 0; while (true) { if (i >= n) break; k.n += i; i++; k = k; } return acc.n; }
function roundOuter(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) k.n += j; k = k; } return acc.n; }
function madeInOuter(n) { let sum = 0; for (let i = 0; i < n; i++) { const acc = { n: i }; let k = acc; for (let j = 0; j < n; j++) { k.n += j; k = k; } sum += acc.n; } return sum; }
function element(n) { const list = [0, 0]; let k = list; for (let i = 0; i < n; i++) { k[0] = (k[0] + i) | 0; k = k; } return list[0]; }
function readInside(n) { const acc = { n: 0 }; let k = acc; let seen = ""; for (let i = 0; i < n; i++) { k.n += i; seen += acc.n + ","; k = k; } return seen + acc.n; }
function storedUnderFirstName(n) { const acc = { n: 0 }; let k = acc; let seen = 0; for (let i = 0; i < n; i++) { acc.n += i; seen += k.n; k = k; } return seen + ":" + k.n; }
report(sum(0));
report(sum(6));
report(swapped(6));
report(leftByBreak(6));
report(roundOuter(4));
report(madeInOuter(4));
report(element(6));
report(readInside(4));
report(storedUnderFirstName(4));
report("end");
