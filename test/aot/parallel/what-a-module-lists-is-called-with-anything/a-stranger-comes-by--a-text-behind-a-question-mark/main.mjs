// It guards against a crash: a `?` in the text of a data: URL once lifted the refusal of loads by names made at run time for every file of the image.
// What lib.mjs lists stays in, so whoever comes by its namespace object gets what plain Bun gives, or an error.
import { sum } from "./lib.mjs";
const table = { used() { return 1; }, never() { return import("./lib.mjs"); } };
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + table.used()) | 0;
console.log(String(total));
const text = await import("data:text/javascript,export default 1 ? 'picked' : 'left';");
console.log(text.default);
let out = "asked";
try {
  const got = await (0, eval)("import(" + JSON.stringify(import.meta.resolve("./lib.mjs")) + ")");
  out = typeof got.sum + " " + typeof got.spare + " " + got.sum("a", "b") + " " + got.spare("c") + " " + got.spare(4);
} catch (e) { out += "|" + e.name + ":" + String(e.message).slice(0, 40); }
console.log(out === "function function ab cc 8" || /\|[A-Za-z]*(Error|Message)/.test(out) ? "the right answer, or none" : "ANOTHER ANSWER: " + out);
