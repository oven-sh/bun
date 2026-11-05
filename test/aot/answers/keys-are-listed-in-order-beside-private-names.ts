// answers: without-library
// # The order of an object lists a private name like any field that is created, and nobody who enumerates sees it: the keys beside it come out in the order in which they were created, whichever way the stores are built.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 22 of 22 of 22
// # CHECK-NEXT: exited with 0
class P { #a = 1; b = 2; #c = 3; d = 4; #e = 5; sum() { return this.#a + this.b + this.#c + this.d + this.#e; } }
class Late { z = 1; #p = 2; a = 3; constructor(more: boolean) { if (more) (this as any).m = 4; } p() { return this.#p; } }
function keysOf(o: object) { let text = ""; for (const key in o) text += key + ","; return text + JSON.stringify(o) + Object.keys(o).length; }
for (let round = 0; round < 3; round++) { const p = new P(); report(p.sum()); report(keysOf(p)); const late: any = new Late(round === 1); late.y = round; report(keysOf(late)); report(late.p()); delete late.z; late.z = 9; report(keysOf(late)); report(late.p()); report(keysOf({ ...late })); }
report("end");
