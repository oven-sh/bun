// reflect construct with another new target is constructed in each turn of a loop; a field is summed
class C { x = 1; y = 2; }
class D { get y() { return "d"; } z = 9; }
function run(n: number) { let total: any = 0; for (let i = 0; i < n; i++) { const made: any = (i === 5 ? Reflect.construct(C, [], D) : new C()); total += made.x; } return total; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
