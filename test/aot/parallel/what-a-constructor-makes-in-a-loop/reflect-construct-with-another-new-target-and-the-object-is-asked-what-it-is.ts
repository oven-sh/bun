// reflect construct with another new target is constructed in each turn of a loop; the object is asked what it is
class C { x = 1; y = 2; }
class D { get y() { return "d"; } z = 9; }
function run(n: number) { let said = ""; for (let i = 0; i < n; i++) { const made: any = (i === 5 ? Reflect.construct(C, [], D) : new C()); said += (made instanceof (C as any) ? "c" : "-") + typeof made.x[0] + Object.keys(made).length; } return said; }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
