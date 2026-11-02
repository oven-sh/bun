// An instance of a class of the program below Array is an array: Array.isArray says so in place, through a parameter declared as the class or a string, below two classes, and in a loop.
class Stack extends Array<number> {}
const s = new Stack();
console.log(Array.isArray(s));
function f(x: Stack | string) { return Array.isArray(x) ? "list" : "text"; }
console.log(f(s), f("t"));
class Deep extends Stack { extra = 1; }
function g(x: Deep | number | null) { return Array.isArray(x) ? "list" : "other"; }
console.log(g(new Deep()), g(5), g(null), Array.isArray(new Deep()));
let lists = 0;
for (let i = 0; i < 20000; i++) { if (Array.isArray(i & 1 ? s : "t")) lists++; if (f(i & 1 ? s : "t") === "list") lists++; }
console.log(lists);
