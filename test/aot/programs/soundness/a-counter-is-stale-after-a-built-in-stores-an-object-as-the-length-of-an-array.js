let calls = 0;
const length = { valueOf() { calls++; return 3; } };
const list = [];
Reflect.set(list, "length", length);
console.log(list.length, calls);
Object.assign(list, { length });
console.log(list.length, calls);
