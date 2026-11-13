// n += x & 1 in a loop inside another stays an integer, as n++ does: a step of one or none passes 2 ** 53 no more than a step of one does.
// STATISTIC: CountsOfLoopsAroundKept >= 2
function bits(list) { let n = 0; for (let i = 0; i < list.length; i++) { let x = list[i]; while (x) { n += x & 1; x >>>= 1; } } return n; }
function falls(list) { let n = 5; for (let i = 0; i < list.length; i++) { let x = list[i]; while (x) { n -= x & 1; x >>>= 1; } } return n; }
function pairs(list) { let n = 0; for (let i = 0; i < list.length; i++) for (let j = i; j < list.length; j++) n += list[i] & list[j] & 1; return n; }
function grid(list, w) { let n = 0; for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) n += list[y * w + x] >> 3 & 1; return n; }
function edge(start, list) { let n = start; for (let i = 0; i < 3; i++) for (let j = 0; j < list.length; j++) n += list[j] & 1; return n; }
function below(start, list) { let n = start; for (let i = 0; i < 3; i++) for (let j = 0; j < list.length; j++) n -= list[j] & 1; return n; }
function either(start, list) { let n = start; for (let i = 0; i < 3; i++) for (let j = 0; j < list.length; j++) n += list[j] & 1 ? 1 : -1; return n; }
function growing(list) { let n = 0; for (let i = 0; i < 60; i++) { for (let j = 0; j < list.length; j++) n += list[j] & 1; n += n; } return n; }
const lists = [[0, 1, 2, 3, 77, 128, 1000, 65535, 1073741824, 2147483647], [0, -1, -77, 5, -2147483648], [2147483648, 4294967295, 7], [0.5, 7.9, -0, NaN, 1e9], ["12", null, undefined, true, 9], [3, , 5], []];
for (const list of lists) {
  console.log(bits(list), falls(list), pairs(list), grid(list, 2), growing(list));
  for (const start of [0, -0, 0.5, 2147483646, 4503599627370495, 9007199254740989, 9007199254740992, -9007199254740990, 1e300, "s"]) console.log(edge(start, list), below(start, list), either(start, list));
}
