// A store to `exports.x` that never runs does not hide the x that `__exportStar` brings.
console.log(require("./lib").x);
