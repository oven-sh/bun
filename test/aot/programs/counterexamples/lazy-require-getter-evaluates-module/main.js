// A getter on `exports` that requires another module evaluates that module at the first read.
console.log(require("./lib").a);
