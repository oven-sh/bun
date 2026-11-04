// A static import loads a file as YAML, then import() asks for it as text. The loader keeps one module per path for all types other than "json", so import() resolves to the YAML module with all its exports.
import parsed from "./data.yaml" with { type: "yaml" };
const loaded = await import("./data.yaml", { with: { type: "text" } });
console.log(loaded.default === parsed, Object.keys(loaded).sort().join(), loaded.a);
