const show = (value) => typeof value + ":" + JSON.stringify(value);
const text = await import("./conf.toml", { with: { type: "text" } });
const { toml } = await import("./as-toml.mjs");
const yaml = await import("./conf.toml", { with: { type: "yaml" } });
console.log(show(text.default), show(toml), show(yaml.default));
