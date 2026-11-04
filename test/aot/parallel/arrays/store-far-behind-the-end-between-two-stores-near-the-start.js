// a list takes a store near its start, one far behind its end, which makes its storage sparse, and another near its start
function subject(xs, i, far) { xs[i & 7] = 1; xs[far] = 2; xs[(i + 1) & 7] = 3; return String(xs.length) + "," + String(xs[i & 7]) + "," + String(xs[(i + 1) & 7]) + "," + String(xs[far]) + "," + String(Object.keys(xs).length); }
function deed(i) { return subject([0, 0, 0, 0, 0, 0, 0, 0], i, 1000000); }
console.log(subject([0, 0, 0, 0, 0, 0, 0, 0], 2, 3));
console.log(deed(2));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i);
console.log(text);
console.log(subject([0, 0, 0, 0, 0, 0, 0, 0], 2, 3));
