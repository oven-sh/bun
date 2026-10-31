// Key order: compiled answers as plain.
const o = { b: 1, 2: 1, a: 1, 1: 1, [Symbol("s")]: 1, "-1": 1, "1.5": 1, "01": 1, 4294967294: 1, 4294967295: 1 };
o.c = 1;
o[0] = 1;
delete o.b;
o.b = 1;
console.log(Object.keys(o).join(), JSON.stringify(o), Reflect.ownKeys(o).length);
