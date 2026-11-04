// a class made anew at each call is constructed in each turn of a loop; the object goes round
function make() { return class { x = 1; y = 2; }; }
let C = make();
function run(n: number) { let last: any = null; for (let i = 0; i < n; i++) { const made: any = (i === 4 ? new (C = make())() : new C()); last = made; } return JSON.stringify(last) + " " + Object.getPrototypeOf(last).constructor.name + " " + String(last.z); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
