// Sums of integers in loops of branches, carried as integers: the number of iterations bounds them.
// STATISTIC: SumsCarriedAsIntegers >= 2
const list = [null, undefined, 0, 1, 2147483647, -2147483648], words = ["a", "bb", "", "cccc"];
function nullish() { let n = 0; for (let k = 0; k < 1000; k++) n += list[k % 6] ?? 7; return n; }
function branches() { let n = 5; for (let k = 0; k < 300; k++) { if (k % 3 === 1) continue; n += typeof list[k % 6] === "number" ? 2147483647 : -3; if (k === 290) break; } return n; }
function nested() { let n = 0, seen = 0; for (let i = 0; i < 20; i++) { for (let k = 0; k < 10; k++) { n += words[(i + k) & 3].length; if (n & 1) n -= 2; } seen += n; } return [n, seen]; }
function read() { let n = 0, text = ""; for (let k = 0; k < 12; k++) { n += list[k % 6] ?? -1; text += n + ","; } return text; }
function thrown() { let n = 0; try { for (let k = 0; k < 50; k++) { n += list[k % 6] ?? 7; if (k === 40) throw n; } } catch (e) { return [e, n]; } }
for (let turn = 0; turn < 3; turn++) console.log(nullish(), branches(), nested().join(), read(), thrown().join());
