import toml from "./other.txt" with { type: "toml" };
import text from "./third.json" with { type: "text" };
console.log(typeof toml, typeof text, JSON.stringify(text));
