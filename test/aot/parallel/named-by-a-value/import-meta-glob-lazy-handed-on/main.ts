const lazy = import.meta.glob("./modules/*.ts") as any;
async function load(all: any, name: string) { return await all[name](); }
const found = await load(lazy, "./modules/b.ts");
console.log(found.default, found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
