// The file as text and the file under ?text are two modules, whoever asks.
import * as code from "./part.mjs?text";
import words from "./part.mjs" with { type: "text" };
import * as plain from "./part.mjs";
const again = await import("./part.mjs", { with: { type: ["te", "xt"].join("") } });
console.log(code.value, words.length, plain.value, code === plain, again.default === words);
