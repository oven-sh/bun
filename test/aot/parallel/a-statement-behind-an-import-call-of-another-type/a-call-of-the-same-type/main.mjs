const loaded = await import("./conf.toml", { with: { type: "toml" } });
const { conf } = await import("./holder.mjs");
console.log(typeof loaded.default, typeof conf, loaded.default === conf);
