// Array.prototype.toString calls `join`, whatever that is: the method of a class below Array, a property of the list itself, the method of an object that is no list; without one it answers as Object.prototype.toString. An argument is no separator. Asked through a function that does not know what it is handed, once and in a loop.
class L extends Array { join() { return "mine"; } }
function s(x) { return Array.prototype.toString.call(x); }
const l = new L(); l.push(1, 2);
const a = [1, 2]; a.join = () => "own";
const parsed = JSON.parse(process.argv[2] ?? "[3,4]");
console.log(s(parsed), s(l), s(a), Array.prototype.toString.call([1, 2], "-"), s({ join() { return "object's"; } }), s({}), s(5));
let total = 0;
for (let i = 0; i < 20000; i++) total += s(i & 1 ? l : i & 2 ? a : parsed).length;
console.log(total);
