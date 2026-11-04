// Static imports load two .txt files as text, then import() asks for them as TOML and as YAML. Both calls resolve to the text modules.
import first from "./first.txt" with { type: "text" };
import second from "./second.txt" with { type: "text" };
const asToml = await import("./first.txt", { with: { type: "toml" } });
const asYaml = await import("./second.txt", { with: { type: "yaml" } });
console.log(asToml.default === first, Object.keys(asToml).join(), asYaml.default === second, Object.keys(asYaml).join());
