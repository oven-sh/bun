// So they are where the query is made of texts.
import text from "./part.mjs" with { type: "text" };
const made = "./part.mjs?" + ["te", "xt"].join("");
const copy = await import(made);
console.log(typeof text, text.length > 10, typeof copy.default, copy.value);
