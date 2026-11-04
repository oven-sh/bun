// a function whose prototype is replaced is constructed in each turn of a loop; the object goes round
function C(this: any, x: number) { this.x = x; this.y = 2; }
C.prototype.z = 3;
function run(n: number) { let last: any = null; for (let i = 0; i < n; i++) { const made: any = (i === 4 && (C.prototype = { z: "three" }), new (C as any)(i & 3)); last = made; } return JSON.stringify(last) + " " + Object.getPrototypeOf(last).constructor.name + " " + String(last.z); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
