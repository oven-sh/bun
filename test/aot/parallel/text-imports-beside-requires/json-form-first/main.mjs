import settings from "./settings.json" with { type: "json" };
import text from "./settings.json" with { type: "text" };
console.log(text.trim(), settings.name);
await import("./later.cjs");
