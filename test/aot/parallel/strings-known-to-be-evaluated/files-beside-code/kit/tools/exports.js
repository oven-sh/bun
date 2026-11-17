exports["print"] = print;
exports["tokens"] = tokens;
exports["options"] = Object.keys(defaults({ a: 1 }, { a: 2, b: 3 }));
exports["strictThis"] = function () { return (function () { return String(this); })(); };
exports["sloppyThis"] = function () { return new Function("return (function () { return typeof this; })();")(); };
exports["fails"] = fails;
exports["line"] = function (f) {
    try { f(); } catch (e) { return /fails/.test(e.stack) + " " + (e.stack.split("\n")[1] || "").replace(/.*:(\d+):\d+\)?$/, "$1"); }
};
