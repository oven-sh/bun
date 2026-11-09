class Rec { a = 1; b = 2; }
const m = new Map<string, Rec>([["a", new Rec()]]);
function put(target: Rec | undefined, source: { a: number }): void { try { Object.assign(target as any, source); } catch (e) { console.log((e as Error).name); } }
for (const k of ["a", "b"]) put(m.get(k), { a: 7 });
console.log(m.get("a")!.a, m.size);
