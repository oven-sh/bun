let n = 0; Object.defineProperty(exports, "counted", { get() { return ++n; }, enumerable: true }); exports.plain = 1; exports.change = () => { exports.plain = 2; };
