import { fetch_ } from "./tools/fetcher.mjs";
let answer;
try { answer = fetch_("./shelf.cjs"); } catch (error) { answer = error.constructor.name; }
console.log(answer);
