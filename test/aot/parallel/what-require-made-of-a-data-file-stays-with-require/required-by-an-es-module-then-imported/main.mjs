// What a require() in an ES module makes of data is another object than what an import() behind it gives.
import { createRequire } from "node:module";
const own = import.meta.require("./shelf.json");
own.planks = 9;
const { default: other } = await import("./shelf.json");
console.log(other === own, other.planks, import.meta.require("./shelf.json") === own);
const load = createRequire(import.meta.url);
const racks = load("./racks.toml");
racks.height = 7;
const imported = await import("./racks.toml");
console.log(imported.default === racks, imported.height, load("./racks.toml").height);
