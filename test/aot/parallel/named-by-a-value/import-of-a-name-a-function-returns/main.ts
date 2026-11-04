// Entry points: ./modules/a.ts ./modules/b.ts
const which = (globalThis as any).never ? "a" : "b";
function nameOf(letter: string) { return ["./modules", letter + ".ts"].join("/"); }
const found = await import(nameOf(which));
console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
