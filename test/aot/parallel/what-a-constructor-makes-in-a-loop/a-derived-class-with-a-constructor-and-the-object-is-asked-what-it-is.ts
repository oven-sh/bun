// a derived class with a constructor is constructed in each turn of a loop; the object is asked what it is
class B { x: number; constructor(x: number) { this.x = x; } }
class C extends B { y: number; constructor(x: number) { super(x + 1); this.y = x; } }
function run(n: number) { let said = ""; for (let i = 0; i < n; i++) { const made: any = new C(i & 3); said += (made instanceof (C as any) ? "c" : "-") + typeof made.x[0] + Object.keys(made).length; } return said; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
