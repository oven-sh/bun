// A function declaration whose name is stored to captures a variable from two functions further out.
function outer(n) { function o() { function i() { return n; } i = i; return i(); } return o(); }
console.log(outer(4));
