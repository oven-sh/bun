var lib = (function () { function Pair(a, b) { this.a = a; this.b = b; this.init(); } Pair.prototype.init = function () { this.total = this.a + this.b; }; return { Pair: Pair }; })();
if (typeof module !== "undefined" && module.exports) module.exports = lib;
else if (typeof window !== "undefined") window.lib = lib;
else if (typeof define === "function") define(function () { return lib; });
