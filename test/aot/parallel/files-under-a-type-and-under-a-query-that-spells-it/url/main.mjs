// The copy has the query in its import.meta.url.
import words from "./part.mjs" with { type: "text" };
import { where } from "./part.mjs?text";
console.log(where, words.length);
try { await import("./part.mjs", { with: { type: "toml" } }); } catch (error) { console.log(error.name); }
