// A static import loads a file as TOML, then import() asks for it as text. The loader keeps one module per path for all types other than "json", so import() resolves to the TOML module with all its exports.
import parsed from "./data.toml" with { type: "toml" };
const loaded = await import("./data.toml", { with: { type: "text" } });
console.log(loaded.default === parsed, Object.keys(loaded).sort().join(), loaded.a);
