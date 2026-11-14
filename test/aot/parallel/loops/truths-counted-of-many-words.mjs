// The truth of a comparison is set in a register that holds none of what is compared, where one is free.
const board = new Uint16Array(20); for (let i = 12; i < 20; i++) board[i] = 0b1011011101 ^ (i * 3);
function holes(h) { let holes = 0; for (let x = 0; x < 10; x++) for (let y = 20 - h[x] + 1; y < 20; y++) if (!(board[y] & (1 << x))) holes++; return holes; }
function many(a, b, c, d, e, f, g, h) { let n = 0; for (let i = 0; i < 9; i++) { n += (a > i) + (b < i) + (c === i) + (d !== i) + (e >= i) + (f <= i) + (g > h) + (a === b); a ^= i; b += c & 1; c = d; d = e; e = f; f = g; g = h; h = a; } return n; }
function chain(list) { let p = 0, q = 0, r = 0, s = 0, t = 0; for (let i = 0; i + 1 < list.length; i++) { const x = list[i], y = list[i + 1]; p += x < y; q += x === y; r += (x & 1) === 0; s += !(x & y); t += x - y > p; } return [p, q, r, s, t]; }
function doubles(list) { let p = 0, q = 0; for (let i = 0; i < list.length; i++) { p += list[i] * 0.5 > i; q += list[i] / 3 === i; } return [p, q]; }
function kept(list) { const out = []; for (let i = 0; i < list.length; i++) { const isLarge = list[i] > 5, isOdd = (list[i] & 1) === 1; out.push(isLarge, isOdd, isLarge === isOdd, isLarge !== (i > 3)); } return out.map(Number).join(""); }
function unsigned(list) { let n = 0; for (let i = 0; i < list.length; i++) { n += (list[i] >>> 0) > 2147483648; n += list[i] >>> 1 === i; } return n; }
const lists = [[8, 7, 6, 8, 8, 5, 8, 8, 3, 8], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [-1, 5, -2147483648, 2147483647, 0, 6, 6, 6, 7, 1], [1.5, 3, 4.25, -0, 9, 10, 11, 12, 13, 14]];
for (let turn = 0; turn < 3; turn++) for (const list of lists) console.log(turn || holes([8, 7, 6, 8, 8, 5, 8, 8, 3, 8]), many(...list), chain(list).join(), doubles(list).join(), kept(list), unsigned(list));
