// A static import loads a file as JSONC, then import() asks for it as text. The loader keeps one module per path for all types other than "json", so import() resolves to the JSONC module with all its exports.
import parsed from "./data.jsonc" with { type: "jsonc" };
const loaded = await import("./data.jsonc", { with: { type: "text" } });
console.log(loaded.default === parsed, Object.keys(loaded).sort().join(), loaded.a);
