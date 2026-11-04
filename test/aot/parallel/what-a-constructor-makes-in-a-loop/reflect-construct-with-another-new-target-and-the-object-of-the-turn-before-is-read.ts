// reflect construct with another new target is constructed in each turn of a loop; the object of the turn before is read
class C { x = 1; y = 2; }
class D { get y() { return "d"; } z = 9; }
function run(n: number) { let last: any = { x: 0, y: 0 }; let total: any = 0; for (let i = 0; i < n; i++) { const made: any = (i === 5 ? Reflect.construct(C, [], D) : new C()); total += last.x; last = made; } return total + " " + JSON.stringify(last); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
