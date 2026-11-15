var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
a.madeUpStore = 5;
console.log(process.madeUpStore, typeof env);
