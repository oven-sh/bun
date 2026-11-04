// Each static import binds one export of a parsed file. import() as text resolves to the same module, which has the other exports too.
import { a as fromToml } from "./first.toml" with { type: "toml" };
import { b as fromYaml } from "./second.yaml" with { type: "yaml" };
const first = await import("./first.toml", { with: { type: "text" } });
const second = await import("./second.yaml", { with: { type: "text" } });
console.log(fromToml, first.a === fromToml, Object.keys(first).sort().join(), JSON.stringify(first.default));
console.log(fromYaml, second.b === fromYaml, Object.keys(second).sort().join(), JSON.stringify(second.default));
