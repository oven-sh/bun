// a base that asks for new target is constructed in each turn of a loop; the object goes round
class B { x: number; y = 1; constructor() { this.x = new.target === B ? 1 : 2; } }
class C extends B { }
function run(n: number) { let last: any = null; for (let i = 0; i < n; i++) { const made: any = (i & 1 ? new C() : new B()); last = made; } return JSON.stringify(last) + " " + Object.getPrototypeOf(last).constructor.name + " " + String(last.z); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
