// a list of integers takes a fraction and then a text near its start, which convert its storage, between two reads of another element
function subject(xs, i, value) { const before = xs[2]; xs[i & 1] = value; return String(before) + "," + String(xs[2]) + "," + String(xs[i & 1]) + "," + String(xs.length); }
function deed(i) { const xs = [1, 2, 3]; return subject(xs, i, 0.5) + ";" + subject(xs, i + 1, "t"); }
console.log(subject([1, 2, 3], 0, 7));
console.log(deed(0));
let text = "";
for (let i = 0; i < 300; i++) text = deed(i);
console.log(text);
console.log(subject([1, 2, 3], 0, 7));
