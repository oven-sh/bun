function early() { return a; }
const first = early();
var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
console.log(first, early() === process, typeof env);
