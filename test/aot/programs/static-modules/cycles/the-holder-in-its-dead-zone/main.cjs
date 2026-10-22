// `const b = require("./b.cjs")`: while b runs, the constant is in its dead zone. A function of a that reads b.value, called by b, throws a ReferenceError. With `var` the variable holds undefined and the read throws a TypeError. Behind the declarations both work.
console.log(require("./a.cjs").results);
