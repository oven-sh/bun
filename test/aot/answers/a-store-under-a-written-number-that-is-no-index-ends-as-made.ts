// answers: with-library
// # -1, 4294967295 and 1.5 are written out, and none is an index: each lays a NAME on the list. Link classed such a name with the elements, as it must for a view, and the site kept "stays as its class has made it".
// # Only a written index keeps that word now. The word is held against the object wherever it is taken: the program would stop where it were false.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 7 of 7 of 7
// # CHECK-NEXT: exited with 0
function below(): string { const a: number[] = [1, 2, 3]; a[-1] = 1; let seen = 0; a.forEach(() => seen++); return seen + "/" + a.indexOf(2) + "/" + a.length + "/" + Object.keys(a).join(); }
function beyond(): string { const a: number[] = [1.5, 2.5]; a[4294967295] = 1; let seen = 0; for (const x of a) seen += x; return seen + "/" + a.includes(1) + "/" + a.length + "/" + Object.keys(a).join(); }
function between(): string { const a: string[] = ["a", "b"]; a[1.5] = "c"; return a.join("") + "/" + a.lastIndexOf("c") + "/" + a.length + "/" + Object.keys(a).join(); }
for (let round = 0; round < 2; round++) { report(below()); report(beyond()); report(between()); }
report("end");
