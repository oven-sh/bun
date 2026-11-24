'use strict';
// What short turns step by constants is read behind the loop: at its end, at exits in the middle, where a turn is run anew, in steps of several sizes and signs, and sums that grow past a word.
function walk(list, stop) { let i = 0, up = 3, down = 100, wide = 2 ** 40; for (; i < list.length; i++) { if (list[i] === stop) break; up += 4; down -= 7; wide += 3e9; } return [i, up, down, wide].join(); }
function pairs(list, stop) { let i = 0, j = list.length - 1, n = 0; while (i < j) { if (list[i] + list[j] === stop) return 'at ' + i + ' ' + j + ' ' + n; i += 1; j -= 1; n += i * 2; } return i + ' ' + j + ' ' + n; }
function threes(list) { let k = 0, s = 0, half = .5; for (; k + 2 < list.length; k += 3) { s = s + list[k] * list[k + 1] - list[k + 2] | 0; half += .5; } const rest = k; for (; k < list.length; k++) s ^= list[k]; return [rest, k, s, half].join(); }
function words(list) { let a = 2147483640, b = -2147483640, c = 4294967290; for (let i = 0; i < list.length; i++) { a += 1; b -= 2; c += list[i] & 1; } return [a, b, c, a | 0, b | 0, c >>> 0].join(); }
function anew(list, by) { let seen = 0, back = 50; for (let i = 0; i < list.length; i++) { const v = list[i]; seen += 2; if (v === undefined) { back -= 5; continue; } if (typeof v !== 'number') return seen + ':' + back + ':' + typeof v; list[i] = v + by; back -= 1; } return seen + ':' + back; }
function late(list) { let n = 0, last = -9; try { for (let i = 0; i < list.length; i++) { last = i * 3; n += 5; if (list[i] < 0) throw n; } } catch (e) { return 'caught ' + e + ' ' + n + ' ' + last; } return n + ' ' + last; }
const row = n => Array.from({ length: n }, (_, i) => i * 13 % 17);
for (let k = 0; k < 120; k++) { walk(row(20), 99); pairs(row(21), 99); threes(row(22)); words(row(9)); anew(row(16), 1); late(row(12)); }
for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 15, 16, 17, 33]) console.log(n, walk(row(n), 9), pairs(row(n), 18), threes(row(n)), words(row(n)), anew(row(n), 2), late(row(n)));
const odd = [1, 2, , 4, 'five', 6, 7.5, null, -1, 9];
console.log(walk(odd, null), pairs(odd, 8), threes(odd), words(odd), anew(odd.slice(), 1), late(odd), anew([1, , 2, , , 3, 4.5], 1));
const far = row(40); far[33] = 1e10; far[34] = -0; console.log(threes(far), anew(far, .5), words(far), walk(far, 1e10));
console.log(walk(new Float32Array(row(9)), 13), pairs(new Uint8Array(row(9)), 21), late(new Int16Array([1, 2, 3, 4, 5, -6])), threes('0123456789'));
