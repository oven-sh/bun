// For in over the prototype chain: compiled answers as plain.
const base = { x: 1, shadow: 1 };
const o = Object.create(base);
o.shadow = 2;
o.y = 3;
Object.defineProperty(o, "hidden", { value: 1 });
Object.defineProperty(base, "hiddenBase", { value: 1, enumerable: false });
const seen = [];
for (const k in o) seen.push(k);
console.log(seen.join());
