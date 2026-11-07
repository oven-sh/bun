const show = (value) => typeof value + ":" + JSON.stringify(value);
const loaded = await import("./conf.jsonc", { with: { type: "text" } });
const { seen } = await import("./holder.mjs");
console.log(show(loaded.default), seen());
