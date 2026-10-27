// In a validating build: every turn of the loop throws in front of the inlined method and catches it, before the object that the method reads and now and then replaces is declared.
function drive(o: Loud | null, n: number): number { let caught = 0; for (let k = 0; k < n; k++) { try { o!.step(k); } catch { caught++; } } return caught; }
console.log(drive(null, 100000));
let held: { n: any } = { n: JSON.parse("1") };
let total = 0;
class Loud { step(k: number): void { total = (total + held.n) | 0; if ((k & 1023) === 0) held = { n: held.n }; } }
console.log(drive(new Loud(), 100000), total);
