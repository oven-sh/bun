// `this` at the top of a CommonJS file is the receiver of the call of its body, and a store to `exports` does not change it. Plain Bun's transpiler writes the variable `exports` in its place, so the expected output follows ECMAScript, as in commonjs/top-level-this-is-the-receiver.
console.log(require("./a.cjs").same);
