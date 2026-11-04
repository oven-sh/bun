// Entry points: ./modules/a.ts ./modules/b.ts
const which = (globalThis as any).never ? "a" : "b";
const table: Record<string, string> = { a: "./modules/a.ts", b: "./modules/b.ts" };
const found = await import(table[which]);
console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
