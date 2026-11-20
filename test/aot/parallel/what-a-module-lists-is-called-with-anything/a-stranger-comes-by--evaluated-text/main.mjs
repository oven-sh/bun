// It guards against a crash: the record of lib.mjs lists `sum`, which the program enters with integers alone, and `spare`, which nothing reaches; between "listed" and "reached" stands a refusal at run time and no fact.
// The road: an indirect eval imports the file by its whole name. Whoever comes by the namespace object so gets what plain Bun gives, or an error.
import { sum } from "./lib.mjs";
const table = { used() { return 1; }, never() { return import("./lib.mjs"); } };
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + table.used()) | 0;
console.log(String(total));
async function attempt(road) {
  let out = "asked";
  try {
    const got = await road();
    out = typeof got.sum + " " + typeof got.spare + " " + got.sum("a", "b") + " " + got.spare("c") + " " + got.spare(4);
  } catch (e) { out += "|" + e.name + ":" + String(e.message).slice(0, 40); }
  console.log(out === "function function ab cc 8" || /\|[A-Za-z]*(Error|Message)/.test(out) ? "the right answer, or none" : "ANOTHER ANSWER: " + out);
}
await attempt(() => (0, eval)("import(" + JSON.stringify(import.meta.resolve("./lib.mjs")) + ")"));
