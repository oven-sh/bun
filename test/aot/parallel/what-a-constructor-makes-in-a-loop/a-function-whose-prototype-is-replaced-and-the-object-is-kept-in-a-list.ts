// a function whose prototype is replaced is constructed in each turn of a loop; the object is kept in a list
function C(this: any, x: number) { this.x = x; this.y = 2; }
C.prototype.z = 3;
function run(n: number) { const kept: any[] = []; for (let i = 0; i < n; i++) { const made: any = (i === 4 && (C.prototype = { z: "three" }), new (C as any)(i & 3)); kept.push(made); } return JSON.stringify(kept.map(one => [one.x, one.y, one.z, one instanceof (typeof C === "function" ? C : Object)])); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
