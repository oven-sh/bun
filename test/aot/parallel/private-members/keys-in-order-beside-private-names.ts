// The keys beside private names come out in the order in which they were created, however the stores of the constructor are built.
const report = (value: unknown) => console.log(value);
class P { #a = 1; b = 2; #c = 3; d = 4; #e = 5; sum() { return this.#a + this.b + this.#c + this.d + this.#e; } }
class Late { z = 1; #p = 2; a = 3; constructor(more: boolean) { if (more) (this as any).m = 4; } p() { return this.#p; } }
function keysOf(o: object) { let text = ""; for (const key in o) text += key + ","; return text + JSON.stringify(o) + Object.keys(o).length; }
for (let round = 0; round < 3; round++) { const p = new P(); report(p.sum()); report(keysOf(p)); const late: any = new Late(round === 1); late.y = round; report(keysOf(late)); report(late.p()); delete late.z; late.z = 9; report(keysOf(late)); report(late.p()); report(keysOf({ ...late })); }
report("end");
