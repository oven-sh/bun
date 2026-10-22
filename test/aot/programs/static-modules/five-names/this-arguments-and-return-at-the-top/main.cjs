// At the top of a CommonJS file `this` is the exports object, `arguments` has five entries, and `return` ends the body.
console.log(JSON.stringify(require("./a.cjs")));
