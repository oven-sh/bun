// Entry points: ./modules/a.ts ./modules/b.ts
const which = (globalThis as any).never ? "a" : "b";
const found = await import("./modules/" + which + ".ts");
const member = (globalThis as any).never ? "default" : "run";
console.log(found[member](), Object.keys(found).sort().join());
