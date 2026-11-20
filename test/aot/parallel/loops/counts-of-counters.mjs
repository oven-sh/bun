// Loops outside of any nest that count the iterations whose counter passes a test: several iterations are laid out at a time, and the loop as written takes what is left over.
// STATISTIC: UnrolledLoopsEmitted >= 4
const multiples = (limit, mask) => { let n = 0; for (let k = 0; k < (limit | 0); k++) if ((k & mask) === 0) n++; return n; };
const remainders = (limit, by) => { let n = 0; for (let k = 0; k < (limit | 0); k++) if (k % 3 === 1) n++; return n + by; };
const above = (limit, least) => { let n = 0; for (let k = 0; k < (limit | 0); k++) if (k > (least | 0)) n++; return n; };
const down = (limit, mask) => { let n = 0; for (let k = limit | 0; k > 0; k--) if (!(k & mask)) n++; return n; };
const letters = (text, letter) => { let n = 0; for (let k = 0; k < text.length; k++) if ((text.charCodeAt(k) | 32) === letter) n++; return n; };
const shifted = (limit, mask) => { let n = 5; for (let k = 0; k < (limit | 0); k++) if (((k >> 2) ^ mask) & 1) n--; return n; };
const show = value => Object.is(value, -0) ? "-0" : String(value);
const attempt = run => { try { return show(run()); } catch (error) { return error.name; } };
const limits = JSON.parse('[0, 1, 2, 3, 5, 7, 8, 9, 15, 16, 17, 23, 24, 25, 31, 64, 100, -1, -8, 2.5]'), masks = JSON.parse('[0, 1, 3, 7, -1, 2147483647, 0.5]');
for (const limit of limits) for (const mask of masks) console.log(limit, mask, [() => multiples(limit, mask), () => remainders(limit, mask), () => above(limit, mask), () => down(limit, mask), () => shifted(limit, mask)].map(attempt).join(" "));
console.log(multiples(9007199254740993, 3), multiples("9", 3), attempt(() => multiples(9n, 3)), attempt(() => multiples({ valueOf() { return 9; } }, 3)), attempt(() => multiples(9, { valueOf() { throw new RangeError("mask"); } })));
for (const text of ["", "a", "Banana", "BANANA and ananas, Anna", "Ωa".repeat(9), "aA".repeat(12) + "a"]) console.log(letters(text, 97), letters(text + text, 110), attempt(() => letters({ length: 2, charCodeAt: k => 65 + k }, 97)));
