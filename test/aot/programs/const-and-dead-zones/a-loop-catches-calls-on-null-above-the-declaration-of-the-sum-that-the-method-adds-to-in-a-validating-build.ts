// In a validating build: every turn of the loop throws in front of the inlined method and catches it, before the variable that the method adds to is declared.
function drive(o: Loud | null, n: number): number { let caught = 0; for (let k = 0; k < n; k++) { try { o!.step(k); } catch { caught++; } } return caught; }
console.log(drive(null, 100000));
let total: any = JSON.parse("0");
class Loud { step(k: number): void { total = total + k; } }
console.log(drive(new Loud(), 100000), total);
