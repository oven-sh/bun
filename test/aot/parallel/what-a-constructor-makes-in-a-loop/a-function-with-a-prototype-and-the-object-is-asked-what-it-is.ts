// a function with a prototype is constructed in each turn of a loop; the object is asked what it is
function C(this: any, x: number) { this.x = x; this.y = 2; }
C.prototype.z = 3;
function run(n: number) { let said = ""; for (let i = 0; i < n; i++) { const made: any = new (C as any)(i & 3); said += (made instanceof (C as any) ? "c" : "-") + typeof made.x[0] + Object.keys(made).length; } return said; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
