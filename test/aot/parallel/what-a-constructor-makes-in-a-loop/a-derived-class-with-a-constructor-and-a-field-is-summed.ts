// a derived class with a constructor is constructed in each turn of a loop; a field is summed
class B { x: number; constructor(x: number) { this.x = x; } }
class C extends B { y: number; constructor(x: number) { super(x + 1); this.y = x; } }
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = new C(i & 3); total += made.x; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
