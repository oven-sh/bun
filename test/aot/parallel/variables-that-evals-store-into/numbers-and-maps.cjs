const out = [];
const say = x => { let t; try { t = typeof x === 'function' ? 'function ' + x.name : typeof x === 'object' && x ? Object.prototype.toString.call(x) : typeof x === 'bigint' ? x + 'n' : Object.is(x, -0) ? '-0' : String(x); } catch (e) { t = 'odd'; } out.push(t); };
(function () { let s = 'abc';
function d(x, y) { return ((x | 0) + (y | 0)) & 255; }
var c = 3;
var o = { a: 1, b: 2 };
let later = null;
function use(i, n) { 
  n = (n + s.length + s.charCodeAt(i % 3)) | 0;
  n = d(n + i, 2);
  c += 1; n = (n + c) | 0;
  o.a = i & 7; n = (n + o.a + o.b) | 0;
   return n; }
function ask(i, n) { return [s + n, d(i, d(1, n)) | 0, c * 2 + n, n + o.a * o.b].join(); }
function bump(k) { c = k; return c; }
function run(t, a) { var i = 4; const r = eval(t); return r; }
const texts = ['var fresh = 5; fresh', 'o.c = 1', 'c = null', "s = new String('zz')", 'var i = 99', "s += 'd'", 'd = d.bind(1, 2)', 'delete o.a', 'd = null', 'try { o = [1, 2]; } finally { later = null; }', '[typeof s, typeof d, typeof c, typeof o].join()', 'c = undefined'];
let total = 0; for (let i = 0; i < 7 * (texts.length + 2); i++) {
  try { total = use(i, total & 0xffff); say(total); } catch (e) { say(e.name); total = i; }
  if (i % 7 === 6) { const t = texts[(i / 7) | 0]; if (t !== undefined) { try { say(run(t, i)); } catch (e) { say('E ' + e.name); } }
    try { say(ask(i, total & 255)); } catch (e) { say(e.name); }
    if (later && i % 2) { try { say(later()); } catch (e) { say('L ' + e.name); } } }
}
for (const t of ['typeof s', 'typeof d', 'typeof c', 'typeof o']) say(run(t, 0));
})();
console.log(out.join('\n'));
