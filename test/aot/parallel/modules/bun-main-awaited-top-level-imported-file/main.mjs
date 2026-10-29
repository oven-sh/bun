// Bun main is awaited at the top level of an imported file.
import { count } from "./imported.mjs";
console.log("the entry point runs", count);
/* Output:
the imported file runs
the entry point runs 0
*/
