// The keys of a record of 65 written fields are copied by a spread, and every element of the copy is stored: the record answers its own keys afterwards.
const R = { f0: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7, f8: 8, f9: 9, f10: 10, f11: 11, f12: 12, f13: 13, f14: 14, f15: 15, f16: 16, f17: 17, f18: 18, f19: 19, f20: 20, f21: 21, f22: 22, f23: 23, f24: 24, f25: 25, f26: 26, f27: 27, f28: 28, f29: 29, f30: 30, f31: 31, f32: 32, f33: 33, f34: 34, f35: 35, f36: 36, f37: 37, f38: 38, f39: 39, f40: 40, f41: 41, f42: 42, f43: 43, f44: 44, f45: 45, f46: 46, f47: 47, f48: 48, f49: 49, f50: 50, f51: 51, f52: 52, f53: 53, f54: 54, f55: 55, f56: 56, f57: 57, f58: 58, f59: 59, f60: 60, f61: 61, f62: 62, f63: 63, f64: 64, };
const c = [...Object.keys(R)];
for (let k = 0; k < c.length; k++) c[k] = "x";
console.log(c[64], Object.keys(R)[64], Object.keys(R)[0], Object.keys(R).length);
