// spread and missing arguments
class Meter { read(a, b = "none", ...rest) { return [a, b, rest.length, arguments.length].join(); } }
function once(m, list) { return m.read() + " | " + m.read(1) + " | " + m.read(...list) + " | " + m.read(1, 2, 3, 4); }
const m = new Meter(); globalThis.kept = m;
console.log(once(m, [7, 8, 9]));
