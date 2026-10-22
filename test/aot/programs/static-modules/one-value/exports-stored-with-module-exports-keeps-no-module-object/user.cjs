const create = require("./function.cjs");
const { one, two } = require("./literal.cjs");
exports.make = () => create() + create.version + one + two();
