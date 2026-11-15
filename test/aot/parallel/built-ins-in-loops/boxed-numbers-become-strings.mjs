// Strings of numbers of both kinds in loops, with other numbers alive across the conversion.
const values = [0.5, 1, -0, 2.25, NaN, 1e21, Infinity, -7, 123456789.125, 4294967296, 0.1 + 0.2, 1e-7, -0.000001, 2147483648, -2147483648.5, 3];
function strings(list, n) { let a = 0.25, b = 0, c = 1, s = ""; for (let k = 0; k < n; k++) { const x = list[k % list.length]; a += 0.5; b = (b + String(x).length) | 0; c = c * 1.0001 + a; s = `${x}` + ":" + (x + "").length + (k & 1 ? String(x / 8) : "") + s.slice(0, 60); } return [a, b, c.toFixed(6), s].join(" "); }
console.log(strings(values, 16), strings(values, 1000), strings([1, 2, 3], 50), strings([0.125], 50));
function lengths(n) { let t = 0; for (let k = 0; k < n; k++) t += String((k & 1023) / 8).length + String(k & 7).length; return t; } console.log(lengths(10), lengths(5000));
function keys(list, n) { const o = {}; let sum = 0; for (let k = 0; k < n; k++) { const x = list[k % list.length]; o[String(x)] = (o[String(x)] ?? 0) + k; sum += x === x ? x : 1; } return Object.keys(o).map(q => q + "=" + o[q]).join() + sum; } console.log(keys(values.slice(0, 5), 40), keys([0.5, 1.5, 2], 300));
function mixed(list, n) { let s = "", m = 0.5; for (let k = 0; k < n; k++) { const x = k % 9 ? list[k % list.length] : null; s = String(x) + s.slice(0, 40); m += k; } return s + m; } console.log(mixed(values, 30), mixed(values, 400));
