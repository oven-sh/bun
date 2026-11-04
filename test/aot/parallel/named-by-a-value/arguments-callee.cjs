const count = function (n) { return n === 0 ? "done" : arguments.callee(n - 1); };
console.log(count(3));
