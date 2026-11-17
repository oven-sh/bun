const show = v => Object.is(v, -0) ? '-0' : typeof v === 'object' && v ? JSON.stringify(v) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? 'sym' : typeof v === 'function' ? 'fn' : String(v);
const lines = [];
const say = (...a) => { lines.push(a.map(show).join(' ')); };
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ': ' + e.message; } };
const values = [undefined, null, false, true, 0, -0, NaN, 1, -1, 0.5, 2147483647, 2147483648, -2147483649, 1e300, Infinity, '', 'a', 'ab', 'a' + String.fromCharCode(98), ('x' + 'y').repeat(3), 'caf\u00e9', '\u4e00', 0n, 1n, -1n, 2n ** 70n, Symbol.iterator, {}, [], [1], function () {}, () => 1, new Map(), /x/, new Date(0), Object(false), Object(''), Object.create(null), Symbol.for('q'), Symbol.for('q'), 'ab', 'x'.concat('y'), 2n ** 70n, 1.0, '1', '0', Object(1)];
function inBranch(a, b) { if (a === b) return 1; return 0; }
function asValue(a, b) { return (a === b ? 1 : 0) + (a !== b ? 2 : 0); }
function inLoop(a, b) { let n = 0; while (a !== b && n < 2) n++; return n; }
function loosely(a, b) { if (a == b) return 1; return 0; }
for (let round = 0; round < 2; round++) for (let i = 0; i < values.length; i++) { let text = ''; for (let j = 0; j < values.length; j++) text += inBranch(values[i], values[j]) + '' + asValue(values[i], values[j]) + inLoop(values[i], values[j]) + tried(() => loosely(values[i], values[j])); say(i, text); }
console.log(lines.join('\n'));
