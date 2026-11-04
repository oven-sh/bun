// Todo: the form that fails to parse becomes a module that throws, and the run time does not treat it as a form of the file
// A static import loads a file as JSONC, then import() asks for it as TOML, which cannot parse it. The loader already holds the JSONC module and parses nothing.
import parsed from "./data.jsonc" with { type: "jsonc" };
const loaded = await import("./data.jsonc", { with: { type: "toml" } });
console.log(loaded.default === parsed, Object.keys(loaded).sort().join());
