// A generator function expression inside an arrow function is a new function each time the arrow runs.
function door(x) { const mid = () => (function* () { x++; })(); return Object.getPrototypeOf(mid()) === Object.getPrototypeOf(mid()); }
console.log(door(0));
