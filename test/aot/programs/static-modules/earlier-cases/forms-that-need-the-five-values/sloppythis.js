exports.who = function () { return this === undefined ? "undefined" : this === globalThis ? "global" : typeof this; };
