const m = new Map();
m.set(...["k", 5]);
m.set(...["k", m.get("k") + 1]);
console.log(m.get("k"), m.size);
export {};
