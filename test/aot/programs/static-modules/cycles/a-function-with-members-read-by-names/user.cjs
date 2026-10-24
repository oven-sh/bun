const create = require("./create.cjs");
exports.early = create.early;
exports.late = create.late;
exports.typeOfTwice = typeof create.twice === "function" ? "function" : undefined;
exports.read = () => [create.early, create.late, create.twice(1)].join(" ");
