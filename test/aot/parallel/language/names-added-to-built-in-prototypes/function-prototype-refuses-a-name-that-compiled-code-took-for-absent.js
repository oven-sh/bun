// Compiled code reads `once` off a function of the program, and the build sees nobody lay that name above functions: it has taken the name for absent. Whoever lays it there by a road that the build does not see is refused aloud. A name beside it that nobody reads is taken.
const text = hex => Buffer.from(hex, "hex").toString();
const handler = () => 1;
function lay(holder, key, value) {
  try { holder[key] = value; return "stored"; } catch (error) { return error.name + ": " + error.message.slice(0, 48); }
}
console.log(typeof handler.once);
console.log(lay(Object.getPrototypeOf(handler), text("6f6e6365"), () => 2));
console.log(lay(Object.getPrototypeOf(handler), text("7477696365"), () => 3));
console.log(typeof handler.once, typeof handler[text("7477696365")]);
handler.once = 4;
console.log(handler.once);
/* Output:
undefined
TypeError: Cannot assign to Function.prototype.once because
stored
undefined function
4
*/
