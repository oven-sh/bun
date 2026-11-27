// The length of an integer's string in loops: String(k), k + '', k.toString(), templates, at every power of ten; strings that are kept; values that are no integers.
const powers = [0, 1, 9, 10, 11, 99, 100, 999, 1000, 9999, 10000, 99999, 100000, 999999, 1000000, 9999999, 10000000, 99999999, 100000000, 999999999, 1000000000, 2147483647];
function measure(turns) { let n = 0; for (let k = 0; k < turns; k++) n += String(k % 1000).length + (k % 100 + '').length * 10 + (k & 65535).toString().length * 100 + `${k >>> 1}`.length * 1000 + ('' + (k % 7)).length; return n; }
console.log(measure(0), measure(1), measure(10), measure(12345), measure(200001));
function each(list) { const o = []; for (let k = 0; k < list.length; k++) { const x = list[k]; o.push(String(x).length, (x + '').length, (x | 0).toString().length, ((x >>> 1) + '').length, (-x + '').length, (x / 2 + '').length); } return o.join(); }
console.log(each(powers)); console.log(each([-1, 0.5, 1e21, NaN, 2 ** 31, -0]));
let kept = '';
function keep(turns) { let n = 0; for (let k = 0; k < turns; k++) { kept = String(k % 500); n += kept.length; const other = k % 50 + ''; n += other.length; kept += other; } return n; }
console.log(keep(1234), kept);
function any(list) { let n = 0; for (const x of list) { try { n += String(x).length + (x + '').length; } catch (error) { n += 1000; } } return n; }
console.log(any([1, 'ab', true, undefined, null, 12.5, { toString() { return 'six'; } }, Symbol('s'), 10n]));
