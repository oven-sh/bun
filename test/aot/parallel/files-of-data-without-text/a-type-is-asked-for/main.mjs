// Reference: bun build --compile
import json from "./nothing.txt" with { type: "json" };
import toml from "./other.txt" with { type: "toml" };
import text from "./third.json" with { type: "text" };
console.log(typeof json, typeof toml, typeof text, JSON.stringify(text));
