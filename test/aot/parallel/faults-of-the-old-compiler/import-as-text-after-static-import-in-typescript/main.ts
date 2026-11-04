// import() as text resolves to the module that a static import loaded as TOML or YAML, whatever type the checker infers for the call.
import toml from "./first.toml" with { type: "toml" };
import yaml from "./second.yaml" with { type: "yaml" };
const first = (await import("./first.toml", { with: { type: "text" } })).default;
const second = (await import("./second.yaml", { with: { type: "text" } })).default;
console.log(typeof first, typeof first === "string" ? first.length : Object.keys(first).join(), (first as unknown) === toml);
console.log(typeof second, typeof second === "string" ? second.length : Object.keys(second).join(), (second as unknown) === yaml);
