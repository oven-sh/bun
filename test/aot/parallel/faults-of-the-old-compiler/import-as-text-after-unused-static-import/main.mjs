// The static imports are unused, and one binds no name. They still load their files, so import() as text resolves to the parsed modules.
import unusedToml from "./first.toml" with { type: "toml" };
import unusedYaml from "./second.yaml" with { type: "yaml" };
import "./third.toml" with { type: "toml" };
for (const loaded of [
  await import("./first.toml", { with: { type: "text" } }),
  await import("./second.yaml", { with: { type: "text" } }),
  await import("./third.toml", { with: { type: "text" } }),
]) {
  console.log(typeof loaded.default, Object.keys(loaded).sort().join(), loaded.a);
}
