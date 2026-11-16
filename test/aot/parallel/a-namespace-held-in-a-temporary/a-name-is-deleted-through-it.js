var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
a.zz1 = 1;
delete a.zz1;
console.log('zz1' in process);
