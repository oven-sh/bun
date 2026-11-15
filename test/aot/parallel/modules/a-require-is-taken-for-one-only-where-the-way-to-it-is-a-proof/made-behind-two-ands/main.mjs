import { createRequire } from "node:module";
const hidden = (value) => [value][JSON.parse("0")];
const fetch_ = hidden(true) && hidden(null) && createRequire(import.meta.url);
let answer;
try { answer = fetch_("./shelf.cjs"); } catch (error) { answer = error.constructor.name; }
console.log(answer);
