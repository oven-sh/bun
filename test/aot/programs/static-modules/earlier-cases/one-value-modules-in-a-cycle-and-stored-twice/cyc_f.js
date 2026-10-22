const user = require("./cyc_user");
module.exports = function f() { return "f"; };
module.exports.early = user.early;
