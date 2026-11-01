// Alone: the stores of other programs would be seen beside its own
// A built-in object comes to the program a second way. What is written that way is read by name.
const back = Object.getPrototypeOf(JSON.parse("0", () => performance));
try { Object.setPrototypeOf(back, { up: 9, __proto__: Object.getPrototypeOf(back) }); } catch (refused) { console.log("refused", refused.constructor.name); }
function ask() { return Performance.prototype.up; }
console.log(ask());
