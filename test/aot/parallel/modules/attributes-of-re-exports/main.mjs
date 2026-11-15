// Bun reads no attributes of a re-export: the file is loaded under its own type, whoever else loads it under which.
import data from "./data.json";
import * as reExports from "./re-exports.mjs";
import { alone } from "./alone.mjs";
import asText from "./data.txt" with { type: "text" };
const json5 = await import("./data.json", { with: { type: "json5" } });
console.log(typeof data, typeof reExports.json, typeof reExports.namespace.default, typeof reExports.text, typeof asText);
console.log(typeof alone, alone.length, typeof json5.default, JSON.stringify(reExports.json), reExports.text.length);
