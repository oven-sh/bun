const show = (value) => typeof value + ":" + JSON.stringify(value);
const loaded = await import("./conf.json5", { with: { type: "json5" } });
const { conf } = await import("./holder.mjs");
console.log(show(loaded.default), show(conf), loaded.default === conf);
