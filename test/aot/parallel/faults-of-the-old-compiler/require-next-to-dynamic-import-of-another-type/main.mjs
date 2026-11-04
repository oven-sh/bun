// require() of the same files returns the namespace object that the loader holds, which is also what import() as text resolves to.
import toml from "./first.toml" with { type: "toml" };
import yaml from "./second.yaml" with { type: "yaml" };
const requiredFirst = require("./first.toml");
const first = await import("./first.toml", { with: { type: "text" } });
const second = await import("./second.yaml", { with: { type: "text" } });
const requiredSecond = require("./second.yaml");
console.log(first.default === toml, requiredFirst === first, Object.keys(first).sort().join(), JSON.stringify(requiredFirst));
console.log(second.default === yaml, requiredSecond === second, Object.keys(second).sort().join(), JSON.stringify(requiredSecond));
