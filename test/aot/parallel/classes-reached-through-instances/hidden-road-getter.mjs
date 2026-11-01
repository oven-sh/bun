// Alone: the stores of other programs would be seen beside its own
// A built-in object comes to the program a second way. What is written that way is read by name.
Performance.prototype.list = [1, 2];
const back = Object.getPrototypeOf(JSON.parse("0", () => performance));
try { Object.defineProperty(back, "list", { get() { return { length: 3 }; }, configurable: true }); } catch (refused) { console.log("refused", refused.constructor.name); }
function ask() { return Performance.prototype.list.length; }
console.log(ask());
