import conf from "./conf.toml" with { type: "toml" };
const { seen } = await import("./holder.mjs");
console.log(typeof conf, seen);
