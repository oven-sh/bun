const made = text => String(globalThis.neverSet ?? text);
const show = async (what, load) => {
  try {
    const all = await load();
    console.log(what, all.tell ? "ran" : `${typeof all.default}:${String(all.default).length}`);
  } catch (error) {
    console.log(what, error.name);
  }
};
await show("code under a query", () => import("./part.mjs?q=1"));
for (const type of ["text", "json"]) {
  await show(`${type} under a query`, () => import("./part.mjs?q=2", { with: { type: made(type) } }));
  await show(`${type} of the file`, () => import("./part.mjs", { with: { type: made(type) } }));
}
await show("code under another query", () => import("./part.mjs?q=3"));
