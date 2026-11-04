module.exports.late = function () { return "early"; };
module.exports = function whole() {};
module.exports.late = function () { return "late"; };
