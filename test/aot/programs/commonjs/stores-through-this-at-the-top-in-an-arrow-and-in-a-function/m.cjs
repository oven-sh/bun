this.a = 1;
exports.b = 2;
exports.viaThis = this === exports && this === module.exports;
(() => { this.c = 3; })();
(function () { if (this) this.d = 4; })();
