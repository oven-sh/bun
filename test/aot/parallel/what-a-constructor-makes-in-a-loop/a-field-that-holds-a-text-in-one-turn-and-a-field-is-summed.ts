// a field that holds a text in one turn is constructed in each turn of a loop; a field is summed
const misfits = JSON.parse('[1, 2, 3, 4, 5, "six", 7, 8]');
class C { x: any; y = 2; constructor(x: any) { this.x = x; } }
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = new C(misfits[i & 7]); total += made.x; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
