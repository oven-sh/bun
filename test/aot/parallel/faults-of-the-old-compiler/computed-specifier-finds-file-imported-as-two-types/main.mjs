// Each file is imported as two types and never without one. import() and require() with computed specifiers and no type still find the files and parse them by extension.
import toml from "./first.toml" with { type: "toml" };
import yaml from "./second.yaml" with { type: "yaml" };
await import("./first.toml", { with: { type: "text" } });
await import("./second.yaml", { with: { type: "text" } });
const computed = specifier => globalThis.neverSet ?? specifier;
console.log(JSON.stringify((await import(computed("./first.toml"))).default), JSON.stringify((await import(computed("./second.yaml"))).default));
console.log(JSON.stringify(require(computed("./first.toml")).default), JSON.stringify(require(computed("./second.yaml")).default), typeof toml, typeof yaml);
