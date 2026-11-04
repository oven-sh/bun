// import() as text resolves to the object that a static import loaded as TOML or YAML. A write through it is visible through the static import.
import toml from "./first.toml" with { type: "toml" };
import yaml from "./second.yaml" with { type: "yaml" };
(await import("./first.toml", { with: { type: "text" } })).default.a = 5;
(await import("./second.yaml", { with: { type: "text" } })).default.a = 6;
console.log(toml.a, toml.b.length, yaml.a, yaml.b.length);
