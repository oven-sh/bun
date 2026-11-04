// a function with a prototype is constructed in each turn of a loop; a field is summed
function C(this: any, x: number) { this.x = x; this.y = 2; }
C.prototype.z = 3;
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = new (C as any)(i & 3); total += made.x; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
