var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
function later() { return a.memoryUsage().rss > 0; }
console.log(later());
