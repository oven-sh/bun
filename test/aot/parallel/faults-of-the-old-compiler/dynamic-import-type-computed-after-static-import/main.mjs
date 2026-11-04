// The type of each import() is computed at run time. A static import already loaded the file under a type of the same kind, so import() resolves to that module with all its exports.
import toml from "./first.toml" with { type: "toml" };
import yaml from "./second.yaml" with { type: "yaml" };
import json from "./third.json" with { type: "json" };
const as = type => ({ with: { type: globalThis.neverSet ?? type } });
const show = (loaded, imported) => console.log(loaded.default === imported, Object.keys(loaded).sort().join(), loaded.a);
show(await import("./first.toml", as("text")), toml);
show(await import("./second.yaml", as("toml")), yaml);
show(await import("./third.json", as("json")), json);
