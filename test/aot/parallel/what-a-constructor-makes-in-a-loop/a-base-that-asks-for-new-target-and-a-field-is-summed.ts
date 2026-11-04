// a base that asks for new target is constructed in each turn of a loop; a field is summed
class B { x: number; y = 1; constructor() { this.x = new.target === B ? 1 : 2; } }
class C extends B { }
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = (i & 1 ? new C() : new B()); total += made.x; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
