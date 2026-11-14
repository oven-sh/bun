// A loop inside another whose test is at its end is entered by a test of its own, without a jump to the end.
// STATISTIC: LoopsEnteredByTest >= 1
function bits(list) { let n = 0; for (let i = 0; i < list.length; i++) { let x = list[i]; while (x) { n += x & 1; x >>>= 1; } } return n; }
function digits(list) { let n = 0; for (let i = 0; i < list.length; i++) { let x = list[i] | 0; while (x > 9) { x = x / 10 | 0; n++; } n += x; } return n; }
function steps(list) { let n = 0; for (let i = 0; i < list.length; i++) { let x = list[i] >>> 0, g = 0; while (x !== 1 && g < 50) { x = x & 1 ? x * 3 + 1 >>> 0 : x >>> 1; g++; } n += g; } return n; }
function links(heads) { let n = 0; for (let i = 0; i < heads.length; i++) { let at = heads[i]; while (at) { n += at.value; if (n > 100000) break; at = at.next; } } return n; }
function strings(list) { let n = 0; for (let i = 0; i < list.length; i++) { let s = String(list[i]), at = 0; while (at < s.length && s.charCodeAt(at) < 58) { n += s.charCodeAt(at); at++; } } return n; }
function doubles(list) { let n = 0; for (let i = 0; i < list.length; i++) { let x = list[i] * 0.75; while (x > 0.5) { n += x; x *= 0.5; } } return n; }
function inner(list) { let n = 0; for (let i = 0; i < 4; i++) { let j = i; while (j < list.length) { let x = list[j]; while (x) { n = n + (x & 1) | 0; x >>= 1; if (x === -1) break; } j += 2; } } return n; }
function caught(list) { let n = 0; for (let i = 0; i < list.length; i++) { let x = list[i]; try { while (x) { n += x & 1; x >>>= 1; if (n === 13) throw n; } } catch (e) { n += e; } finally { n++; } } return n; }
const link = (...values) => values.reduceRight((next, value) => ({ value, next }), null);
const lists = [[0, 1, 2, 3, 77, 128, 1000, 65535, 1073741824, 2147483647], [0, -1, -77, 5, -2147483648], [2147483648, 4294967295, 7], [0.5, 7.9, -0, 1e9], ["12", null, undefined, true, 9], [3, , 5], []];
for (const list of lists) console.log(bits(list), digits(list), steps(list), strings(list), doubles(list), inner(list), caught(list));
console.log(links([]), links([null, link(1, 2, 3), link(), link(5), link(70000, 70000, 1)]));
