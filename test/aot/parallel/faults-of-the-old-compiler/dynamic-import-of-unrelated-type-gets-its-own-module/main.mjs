// Pairs that do not share a module: no type and "text", "json" and "text", "toml" and no type. A static import in a file that is never loaded shares nothing either.
import untyped from "./first.toml";
import json from "./second.json" with { type: "json" };
import typed from "./third.toml" with { type: "toml" };
const show = (loaded, imported) => console.log(typeof loaded.default, loaded.default === imported, Object.keys(loaded).sort().join());
show(await import("./first.toml", { with: { type: "text" } }), untyped);
show(await import("./second.json", { with: { type: "text" } }), json);
show(await import("./third.toml"), typed);
show(await import("./fourth.yaml", { with: { type: "text" } }), undefined);
if (globalThis.neverSet) await import("./never-loaded.mjs");
