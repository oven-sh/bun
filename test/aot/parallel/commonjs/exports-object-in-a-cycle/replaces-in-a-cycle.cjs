exports.early = "on the first object";
const partner = require("./partner.cjs");
module["exp" + "orts".slice(0)] = function replacement() {};
module.exports.partner = partner;
exports.afterwards = "on the first object too";
