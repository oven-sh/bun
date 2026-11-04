const o = { 0: 1, 1: 2, x: 3 };
const lists = [[], [1]];
for (const l of lists) { const i = l.length; o[i] = "text" + i; }

console.log(typeof o[0], typeof o[1], typeof o.x, o[0], o[1], o.x);
