const table = { entry: { path: "./b.mjs" } };
function change({ entry }, other = 0) { var entry; entry.path = "./c.mjs"; }
change(table);
export async function load() { return (await import(table.entry.path)).name; }
