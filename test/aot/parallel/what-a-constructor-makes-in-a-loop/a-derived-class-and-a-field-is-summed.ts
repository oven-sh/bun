// a derived class is constructed in each turn of a loop; a field is summed
class B { x = 1; }
class C extends B { y = 2; }
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = new C(); total += made.x; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
