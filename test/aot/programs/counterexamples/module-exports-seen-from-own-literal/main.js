// `module.exports = { a: 1, b: f() }`: f runs before the assignment and does not see a.
console.log(require("./lib").b);
