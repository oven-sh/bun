// base and derived by turns is constructed in each turn of a loop; the object is asked what it is
class B { x = 1; y = 5; }
class C extends B { z = 2; }
function run(n: number) { let said = ""; for (let i = 0; i < n; i++) { const made: any = (i & 1 ? new C() : new B()); said += (made instanceof (C as any) ? "c" : "-") + typeof made.x[0] + Object.keys(made).length; } return said; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
