'use strict';
const rope = JSON.parse('"co"') + JSON.parse('"nst"'), longRope = JSON.parse('"const"') + JSON.parse('"ant"').repeat(40);
const subjects = ['const', rope, longRope, 'cons', 'constant', 'Const', '', 'cönst', '中文字符串', 5, NaN, null, undefined, true, { toString() { return 'const'; } }, ['const'], Symbol.for('const'), new String('const'), 5n];
function count(x) { let c = 0; for (let i = 0; i < 12; i++) { if (x === 'const') c += 2; if (x !== 'const') c += 3; c += x === '' ? 5 : 7; } return c; }
function wide(x) { let c = 0; for (let i = 12; i > 0; i--) c += (x === 'cönst' ? 1 : 0) + (x === '中文字符串' ? 10 : 0); return c; }
globalThis.kept = [count, wide];
console.log(subjects.map(count).join(), subjects.map(wide).join());
