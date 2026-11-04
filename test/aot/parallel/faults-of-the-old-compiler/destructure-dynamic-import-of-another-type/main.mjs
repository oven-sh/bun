// The exports of a parsed file are read directly from an awaited import() as text, by destructuring and by member access. A static import loaded the file as TOML or YAML, so they exist.
import toml from "./first.toml" with { type: "toml" };
import yaml from "./second.yaml" with { type: "yaml" };
const { a, b, default: whole } = await import("./first.toml", { with: { type: "text" } });
console.log(whole === toml, a, JSON.stringify(b));
console.log((await import("./second.yaml", { with: { type: "text" } })).a, typeof yaml);
