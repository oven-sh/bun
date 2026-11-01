// Alone: the stores of other programs would be seen beside its own
// A built-in object comes to the program a second way. What is written that way is read by name.
import { atob as other } from "node:buffer";
atob[1] = [1, 2];
const back = other;
try { back[1] = { length: 3 }; } catch (refused) { console.log("refused", refused.constructor.name); }
function ask() { return atob[1].length; }
console.log(ask());
