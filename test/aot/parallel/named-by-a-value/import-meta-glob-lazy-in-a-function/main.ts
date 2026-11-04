function table() { return import.meta.glob("./modules/*.ts") as any; }
const found = await table()["./modules/b.ts"]();
console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
