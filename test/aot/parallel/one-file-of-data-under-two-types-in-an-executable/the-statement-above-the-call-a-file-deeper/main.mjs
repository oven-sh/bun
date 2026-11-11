const show = (value) => typeof value + ":" + JSON.stringify(value);
import conf from "./conf.toml" with { type: "toml" };
import { pending } from "./deep.mjs";
const loaded = await pending;
console.log(show(conf), show(loaded.default), Object.keys(loaded).sort().join(), loaded.default === conf);
