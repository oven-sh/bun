const out = [];
const say = x => { let t; try { t = typeof x === 'function' ? 'function ' + x.name : typeof x === 'object' && x ? Object.prototype.toString.call(x) : typeof x === 'bigint' ? x + 'n' : Object.is(x, -0) ? '-0' : String(x); } catch (e) { t = 'odd'; } out.push(t); };
let f = function (x) { return (x + 1) & 1023; };
let l = [1, 2, 3, 4];
var s = 'abc';
function d(x, y) { return ((x | 0) + (y | 0)) & 255; }
let later = null;
function use(i, n) { for (let k = 0; k < 6; k++) { i += k;
  n = f(n + i);
  l[i & 3] = i; n = (n + l[(i + 1) & 3]) | 0;
  n = (n + s.length + s.charCodeAt(i % 3)) | 0;
  n = d(n + i, 2);
  } return n; }
function ask(i, n) { return [f(f(i)) + n, n + l.length + l[2], s + n, d(i, d(1, n)) | 0].join(); }
const run = (t, a) => { var fresh = 1; return eval(t); };
const texts = ['function d(x) { return -x; }', 's = null', 'f = (x, y) => y === undefined ? 1 : 2', 'var l = 41; l', 'const l = 1; typeof l', 'l = { 0: 1, 1: 2, 2: 3, 3: 4, length: 9 }', "s = ['q']", 'l = new Float32Array(4)', 'd.x = 1', 'arguments.length', 'f = function (x) { return x * 2 & 511; }', 'eval("l[10] = 1.5")'];
let total = 0; for (let i = 0; i < 7 * (texts.length + 2); i++) {
  try { total = use(i, total & 0xffff); say(total); } catch (e) { say(e.name); total = i; }
  if (i % 7 === 6) { const t = texts[(i / 7) | 0]; if (t !== undefined) { try { say(run(t, i)); } catch (e) { say('E ' + e.name); } }
    try { say(ask(i, total & 255)); } catch (e) { say(e.name); }
    if (later && i % 2) { try { say(later()); } catch (e) { say('L ' + e.name); } } }
}
for (const t of ['typeof f', 'typeof l', 'typeof s', 'typeof d']) say(run(t, 0));
console.log(out.join('\n'));
