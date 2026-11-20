// Loops whose turns store into the rows that they find carry a sum, a count and the last value round, go on early, end early and stand under a handler: whichever arm a turn took, the next one finds what it left.
'use strict';
function sweep(rows, at, much) {
  let sum = 0, turns = 0, last;
  for (let k = 0; k < rows.length; k++) {
    last = rows[k][at];
    rows[k][at] = last * much + rows[k][at + 1];
    rows[k][at + 1] = rows[k][at] - last / 4;
    turns++;
    if (rows[k][at] > 50) continue;
    sum += rows[k][at + 1];
    if (sum < -20) break;
    if (last === 0) { sum -= 1; continue; }
    sum *= 2;
  }
  return [sum, turns, last];
}
function guarded(rows, at) { let sum = 0, wrong = 0, kept = null; for (let k = 0; k < rows.length; k++) { try { kept = rows[k][at + 1]; rows[k][at + 1] = rows[k][at] * 2 - kept; rows[k][at] = rows[k][at + 1] + sum; sum += rows[k][at]; } catch (error) { wrong++; kept = error.constructor.name; } finally { sum += 0.5; } } return [sum, wrong, kept]; }
function nested(tables, at) { let all = 0; for (const rows of tables) { let best = -Infinity; for (let k = 0; k < rows.length; k++) { const was = rows[k][at]; rows[k][at] = rows[k][at + 1] - was; rows[k][at + 1] = was + rows[k][at] * 0.5; if (rows[k][at + 1] > best) best = rows[k][at + 1]; } all += best; } return [all, tables.length, at]; }
const rows = () => [[1.5, 2.25, 3], [0, 4.5, 6], [-3.5, 0.5, 1], [40.5, 12.25, 2], [2.5, 1.25, 8]], show = v => Object.is(v, -0) ? '-0' : typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v), text = t => t.map(r => r && typeof r === 'object' ? Array.from(r, show).join(',') : String(r)).join('/');
const told = (f, t, ...rest) => { let end; try { end = f(t, ...rest).map(show).join(' '); } catch (error) { end = error.constructor.name; } return end + ' | ' + text(t); };
for (let k = 0; k < 120; k++) { sweep(rows(), k & 1, 0.5); guarded(rows(), k & 1); nested([rows(), rows()], k & 1); }
console.log(told(sweep, rows(), 0, 0.5)); console.log(told(sweep, rows(), 1, 2)); console.log(told(guarded, rows(), 0)); console.log(told(sweep, rows(), 0, -9)); { const a = rows(), b = rows(); console.log(nested([a, b, []], 1).map(show).join(' '), text(a) === text(b)); }
const kinds = { nanFirst: t => { t[0][0] = NaN; }, nanLast: t => { t[4][1] = NaN; }, every: t => t.forEach(r => { r[1] = NaN; }), hole: t => { delete t[2][1]; }, short: t => { t[3].length = 1; }, whole: t => { t[1] = [1, 2, 3]; }, wholes: t => t.forEach((r, i) => { t[i] = [i, i + 1, 2]; }), text: t => { t[2][0] = '4'; }, frozen: t => { Object.freeze(t[2]); }, view: t => { t[2] = new Float64Array([1, 2, 3]); }, clamped: t => { t[1] = new Uint8ClampedArray([1, 2, 3]); }, missing: t => { t[3] = undefined; }, big: t => { t[2][1] = 7n; }, shared: t => { t[3] = t[0]; }, object: t => { let n = 0; t[1][0] = { valueOf: () => ++n }; }, symbol: t => { t[4][0] = Symbol('s'); }, zero: t => { t[0] = [-0, 0, 0]; t[1] = [0, -0, 0]; }, record: t => { t[2] = { 0: 1, 1: 2 }; } };
for (const name of Object.keys(kinds)) { for (const f of [sweep, guarded]) { const t = rows(); kinds[name](t); console.log(name, told(f, t, 0, 0.5)); } const a = rows(); kinds[name](a); let end; try { end = nested([rows(), a], 0).map(show).join(' '); } catch (error) { end = error.constructor.name; } console.log(name, end, text(a)); }
const setters = { swaps: t => () => { t[2] = [9, 9, 9]; t[3] = t[0]; }, cuts: t => () => { t.length = 3; }, adds: t => () => { if (t.length < 8) t.push([0.5, 0.25, 0]); }, getter: t => () => { let n = 0; const a = [1, 2, 3], b = [4, 5, 6]; Object.defineProperty(t, 2, { get: () => (n++ & 1 ? a : b), configurable: true }); }, freezes: t => () => { Object.freeze(t[2]); }, throws: () => () => { throw new RangeError('set'); } };
for (const name of Object.keys(setters)) for (const f of [sweep, guarded]) { const t = rows(); let first = true, value = t[1][0]; const act = setters[name](t); Object.defineProperty(t[1], 0, { get: () => value, set(v) { value = v; if (first) { first = false; act(); } }, configurable: true, enumerable: true }); console.log(name, told(f, t, 0, 0.5)); }
