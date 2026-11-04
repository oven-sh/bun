const o = { 0: 1, 1: 2, x: 3 };
const texts = ["0", "1"];
for (const t of texts) { const i = t >>> 0; o[i] = "text" + i; }

console.log(typeof o[0], typeof o[1], typeof o.x, o[0], o[1], o.x);
