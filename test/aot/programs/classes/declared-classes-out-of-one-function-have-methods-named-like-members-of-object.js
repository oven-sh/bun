// With declared functions: Classes out of one function have methods named like members of Object.prototype; their objects stand in one list with a plain object and an object of another class.
function make(name) { return class { toString() { return name; } valueOf() { return 40 + name.length; } hasOwnProperty(k) { return name + k; } }; }
class Plain { }
const a = new (make("a"))(), b = new (make("bb"))();
console.log(a.toString(), b.toString(), a.valueOf(), b.valueOf(), a.hasOwnProperty("k"), b.hasOwnProperty("k"));
console.log(`${a}`, `${b}`, a + 1, b + 1);
console.log(a.toString === Object.prototype.toString, a.toString === b.toString);
const list = [a, new Plain(), b, {}];
for (let i = 0; i < 4; i++) console.log(list[i].toString(), list[i].hasOwnProperty("k"));
