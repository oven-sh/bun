const split = require("./beta.cjs");
function build() { return split(); }
module.exports = { kind: typeof build };
