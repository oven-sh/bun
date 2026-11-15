// Instances of built-in classes are put below heirs of other built-ins: what is read off them then is a member of those.
class Sub extends Array { }
class Deeper extends Sub { }
const show = (value) => typeof value === "function" ? value.name : typeof value;
function optional(l) { return l.map?.((x) => x + 1)?.length; }
function read(l) { return show(l.findLast); }
function tested(l) { const found = l.toReversed; return found ? show(found) : "none"; }
const view = new Uint8Array(2);
Object.setPrototypeOf(view, Sub.prototype);
console.log(optional(view));
const other = new Float64Array(2);
other.__proto__ = Deeper.prototype;
console.log(read(other));
class Dates extends Date { }
const pattern = /a/;
console.log(show(pattern.getTimezoneOffset));
Reflect.setPrototypeOf(pattern, Dates.prototype);
console.log(show(pattern.getTimezoneOffset));
const map = new Map();
Object.setPrototypeOf(map, Sub.prototype);
console.log(tested(map));
