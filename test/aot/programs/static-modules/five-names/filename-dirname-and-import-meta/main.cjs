// `__filename`, `import.meta` in a CommonJS file, and the number of arguments of its body: five, as in Node. Plain Bun hands `import.meta` to a file that names it as a sixth.
console.log(require("./a.cjs").join());
