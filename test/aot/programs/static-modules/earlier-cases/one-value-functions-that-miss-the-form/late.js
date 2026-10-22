module.exports = function early() { return "early"; };
module.exports.swap = function () { module.exports = function swapped() { return "swapped"; }; };
