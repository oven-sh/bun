// a constructor that returns another object is constructed in each turn of a loop; the object is kept in a list
class C { x = 1; y = 2; constructor(other: boolean) { if (other) return { x: "one", y: "two" } as any; } }
function run(n: number) { const kept: any[] = []; for (let i = 0; i < n; i++) { const made: any = new C(i === 5); kept.push(made); } return JSON.stringify(kept.map(one => [one.x, one.y, one.z, one instanceof (typeof C === "function" ? C : Object)])); }
for (const n of [0, 1, 3, 8, 20]) { let said: string; try { said = String(run(n)); } catch (error) { said = (error as Error).name + ": " + (error as Error).message; } console.log(n, said); }
