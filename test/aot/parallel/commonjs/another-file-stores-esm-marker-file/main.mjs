// Another file stores the es module marker of a file behind its import.
import below, * as all from "./marked.cjs";
import "./clears-the-marker.cjs";

console.log(JSON.stringify(below));
console.log(JSON.stringify(all.default));
/* Output:
"text"
"text"
*/
