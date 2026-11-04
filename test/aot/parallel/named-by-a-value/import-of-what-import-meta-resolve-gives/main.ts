// Entry points: ./modules/a.ts ./modules/b.ts
const which = (globalThis as any).never ? "a" : "b";
const found = await import(import.meta.resolve("./modules/" + which + ".ts"));
console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
