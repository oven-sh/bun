// The static import as TOML is in a file that only one other file imports. An import() as text after both have run gets the TOML module.
import { doubled } from "./mid.mjs";
const loaded = await import("./conf.toml", { with: { type: "text" } });
console.log(doubled, typeof loaded.default, Object.keys(loaded).sort().join());
