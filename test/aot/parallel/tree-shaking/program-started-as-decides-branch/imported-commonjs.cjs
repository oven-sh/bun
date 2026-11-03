function whenMain() { return "imported-commonjs.cjs is the entry point"; }
function whenNotMain() { return "imported-commonjs.cjs is not the entry point"; }

module.exports = require.main === module ? whenMain() : whenNotMain();
