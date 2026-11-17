const m = new Map();
for (const w of "a b a c a".split(" ")) m.set(...[w, (m.get(...[w]) ?? 0) + 1]);
console.log([...m].join("|"));
export {};
