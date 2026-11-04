const o = { 0: 1, 1: 2, x: 3 };

for (let i = 0; i < 2; i++) { o[i] = "text" + i; }

console.log(typeof o[0], typeof o[1], typeof o.x, o[0], o[1], o.x);
