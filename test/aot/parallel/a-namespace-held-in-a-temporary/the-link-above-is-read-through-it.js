var a; const env = (a = process) === null || a === void 0 ? void 0 : a.env;
console.log(typeof Object.getPrototypeOf(a), typeof a.__proto__, typeof a.constructor, typeof Object.getPrototypeOf(a).emit);
