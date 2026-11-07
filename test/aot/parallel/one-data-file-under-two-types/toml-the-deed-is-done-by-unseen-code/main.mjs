const show = (value) => typeof value + ":" + JSON.stringify(value);
const unseen = (0, eval)("(load) => load()");
const loaded = await unseen(() => import("./conf.toml", { with: { type: "toml" } }));
const { seen } = await import("./holder.mjs");
console.log(show(loaded.default), seen);
