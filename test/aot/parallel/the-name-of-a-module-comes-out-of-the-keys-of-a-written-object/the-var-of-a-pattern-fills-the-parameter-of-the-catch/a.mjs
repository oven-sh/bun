const table = { entry: { path: "./b.mjs" } };
try { throw 0; } catch (entry) { var { entry } = table; entry.path = "./c.mjs"; }
export async function load() { return (await import(table.entry.path)).name; }
