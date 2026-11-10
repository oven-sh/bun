const seed = Number(process.argv[2] ?? 3);
let asked = 0;
const map = { get first() { asked++; return { get() { return "made" + asked; } }; }, second: { get() { return asked + seed; } } };
function T() {}
Object.defineProperties(T.prototype, map);
Object.defineProperties(T.prototype, { third: map.first });
const t = new T();
console.log(t.first, t.second, t.third, asked);
