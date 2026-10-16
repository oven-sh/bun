// Direct eval of `new.target` in an arrow function inside a function.
console.log((function () { return (() => eval("typeof new.target"))(); })());
