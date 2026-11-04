// a class made anew at each call is constructed in each turn of a loop; two fields are summed
function make() { return class { x = 1; y = 2; }; }
let C = make();
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = (i === 4 ? new (C = make())() : new C()); total += made.x + made.y; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
