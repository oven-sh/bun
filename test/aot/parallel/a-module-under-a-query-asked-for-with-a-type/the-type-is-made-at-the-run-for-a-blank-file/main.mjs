const made = text => String(globalThis.neverSet ?? text);
const show = async (what, load) => {
  try {
    console.log(what, Object.keys(await load()).length);
  } catch (error) {
    console.log(what, error.name);
  }
};
await show("code under a query", () => import("./blank.mjs?q=1"));
await show("json under a query", () => import("./blank.mjs?q=2", { with: { type: made("json") } }));
