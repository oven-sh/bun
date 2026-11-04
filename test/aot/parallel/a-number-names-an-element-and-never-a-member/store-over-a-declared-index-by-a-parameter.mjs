const o = { 0: 1, 1: 2, x: 3 };

function at(i) { o[i] = "text" + i; }
at(0); at(1);

console.log(typeof o[0], typeof o[1], typeof o.x, o[0], o[1], o.x);
