// The symbol that a call returns is pushed into an array, read back and passed to a function.
function show(x) { return typeof x; }
function make() { return Symbol("dog"); }
const list = []; list.push(make());
console.log(show(list[0]));
