// Alone: the stores of other programs would be seen beside its own
// A built-in object comes to the program a second way. What is written that way is read by name.
import { atob as other } from "node:buffer";
atob.list = [1, 2];
const back = other;
try { Object.assign(back, { list: { length: 3 } }); } catch (refused) { console.log("refused", refused.constructor.name); }
function ask() { return atob.list.length; }
console.log(ask());
