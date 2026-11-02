// counts-down.cjs starts three tasks that count `pending` down. An ES importer holds the count as it was when the body of the file ended.
import { pending } from "./index.mjs";

console.log(pending);
setTimeout(() => console.log(pending, require("./counts-down.cjs").pending));
