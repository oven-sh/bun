const show = (value) => typeof value + ":" + JSON.stringify(value);
const loaded = await import("./conf.toml", { with: { type: "toml" } });
const { seen } = await import("./holder.mjs");
console.log(show(loaded.default), seen);
