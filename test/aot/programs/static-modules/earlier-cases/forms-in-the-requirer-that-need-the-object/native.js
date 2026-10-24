exports.a = 1;
exports.has = Object.prototype.hasOwnProperty;
exports.bound = function () { return this; }.bind("bound");
exports.swapped = function () { return "first"; };
exports.swap = function () { exports.swapped = function () { return this === exports; }; };
