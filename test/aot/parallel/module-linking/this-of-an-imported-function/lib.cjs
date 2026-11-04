exports.who = function () { return this === undefined ? "undefined" : this === exports ? "exports" : typeof this; };
