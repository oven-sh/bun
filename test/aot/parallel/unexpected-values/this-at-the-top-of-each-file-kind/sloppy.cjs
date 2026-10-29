exports.top = this === undefined ? "undefined" : this === null ? "null" : this === globalThis ? "the global object" : typeof this;
exports.isTheExportsObject = this === exports;
exports.inAnArrow = (() => this === undefined ? "undefined" : this === null ? "null" : this === globalThis ? "the global object" : typeof this)();
