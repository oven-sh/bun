var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
const kept = a.on;
a.on = function () { return 7; };
console.log(process.on());
a.on = kept;
