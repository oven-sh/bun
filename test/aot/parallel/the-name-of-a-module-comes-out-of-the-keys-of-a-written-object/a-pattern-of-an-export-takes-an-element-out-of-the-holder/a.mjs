const table = { entry: { path: "./b.mjs" } };
export const { entry } = table;
export async function load() { return (await import(table.entry.path)).name; }
