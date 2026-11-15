const m = new Map([["a", 1]]);
m.get(...["a"]);
m.set(...["b", 2]);
void m.get(...["b"]);
console.log(m.size);
export {};
