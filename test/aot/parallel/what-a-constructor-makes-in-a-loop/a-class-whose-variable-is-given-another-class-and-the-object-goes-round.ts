// a class whose variable is given another class is constructed in each turn of a loop; the object goes round
let C: any = class { x = 1; y = 2; };
function run(n: number) { let last: any = null; for (let i = 0; i < n; i++) { const made: any = (i === 4 && (C = class { x = "a"; y = "b"; }), new C()); last = made; } return JSON.stringify(last) + " " + Object.getPrototypeOf(last).constructor.name + " " + String(last.z); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
