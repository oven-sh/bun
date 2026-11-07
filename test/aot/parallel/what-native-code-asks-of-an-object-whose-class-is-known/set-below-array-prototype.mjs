const s = new Set();
s.add(1);
Object.setPrototypeOf(s, Array.prototype);
const copy = new Set(s);
console.log(copy.size === 0 ? "walked as a list" : "walked as a set");
