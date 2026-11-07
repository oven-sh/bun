// Reference: bun build --compile
import { conf } from "./holder.mjs";
let texts = 0, objects = 0;
for (let i = 0; i < 300; i++) { const loaded = await import("./conf.toml", { with: { type: "text" } }); if (typeof loaded.default === "string") texts += loaded.default.length; else objects += loaded.default.port; }
console.log(typeof conf, texts, objects);
