const text = require("./notes.txt");
console.log(typeof text, JSON.stringify(text));
const typed = require("./other.txt", { type: "text" });
console.log(typeof typed, JSON.stringify(typed));
/* Output:
string "a note\n"
object {"default":"another\n"}
*/
