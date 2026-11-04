// Entry points: ./modules/a.ts ./modules/b.ts
const which = (globalThis as any).never ? "a" : "b";
const found = await import(new URL("./modules/" + which + ".ts", import.meta.url).href);
console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
