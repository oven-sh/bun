// base and derived by turns is constructed in each turn of a loop; two fields are summed
class B { x = 1; y = 5; }
class C extends B { z = 2; }
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = (i & 1 ? new C() : new B()); total += made.x + made.y; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
