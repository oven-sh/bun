// For in lists a static field named like a static method.
class Base { static m = 1; static m() {} }
const r = [];
for (const key in Base) r.push(key);
console.log(r.join());
