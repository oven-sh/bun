// a field that holds a text in one turn is constructed in each turn of a loop; the object is kept in a list
const misfits = JSON.parse('[1, 2, 3, 4, 5, "six", 7, 8]');
class C { x: any; y = 2; constructor(x: any) { this.x = x; } }
function run(n: number) { const kept: any[] = []; for (let i = 0; i < n; i++) { const made: any = new C(misfits[i & 7]); kept.push(made); } return JSON.stringify(kept.map(one => [one.x, one.y, one.z, one instanceof (typeof C === "function" ? C : Object)])); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
