function callable(x) { return typeof x; }
callable.helper = function (x) { return typeof x + "?"; };
module.exports = callable;
