// A static import loads a file as JSON5, then import() asks for it as text. The loader keeps one module per path for all types other than "json", so import() resolves to the JSON5 module with all its exports.
import parsed from "./data.json5" with { type: "json5" };
const loaded = await import("./data.json5", { with: { type: "text" } });
console.log(loaded.default === parsed, Object.keys(loaded).sort().join(), loaded.a);
