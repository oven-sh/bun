var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
a = Bun;
console.log(typeof env, typeof a.version);
