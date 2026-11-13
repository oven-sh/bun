// Functions that add an int32 to an element in place, called in loops: past int32, into arrays of doubles, holes, other values, shorter arrays, other names, minus zero, several elements.
const show = x => Object.is(x, -0) ? "-0" : String(x);
const out = [];
const acc = [0, 0];
function add(x) { acc[0] += x; acc[1]++; }
function run(turns) { for (let k = 0; k < turns; k++) add(k & 7); }
for (const turns of [0, 1, 9, 1000]) { run(turns); out.push(acc.map(show).join(" ")); }
acc[0] = 2147483640; run(9); out.push(acc.map(show).join(" "));
acc[0] = -0; run(1); run(3); out.push(acc.map(show).join(" "));
acc[0] = 0.5; run(5); out.push(acc.map(show).join(" "));
const sums = [0, 0, 0, 0];
function at(i, x) { sums[i] += x; sums[i] -= 1; }
function spread(turns) { for (let k = 0; k < turns; k++) at(k & 3, k); }
spread(21); out.push(sums.join()); delete sums[2]; spread(5); out.push(sums.map(show).join()); sums.length = 2; spread(5); out.push(sums.map(show).join());
const texts = [1, 2];
function join(x) { texts[0] += x; }
function each(turns) { for (let k = 0; k < turns; k++) join(k); out.push(texts.join()); }
each(4); texts[0] = "t"; each(4); texts[0] = null; each(2);
const lists = { row: [1, 2, 3] };
function bump(x) { lists.row[1] += x; }
function rows(turns) { for (let k = 0; k < turns; k++) { bump(k); if (k === 3) lists.row = [5, 6]; } out.push(lists.row.join()); }
rows(3); rows(8);
const big = [1]; function grow(x) { big[0] += x; } function far(turns) { for (let k = 0; k < turns; k++) grow(1073741824); out.push(big[0]); } far(1); far(5);
console.log(out.join("\n"));
