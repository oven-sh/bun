const out = [];
const say = x => { let t; try { t = typeof x === 'function' ? 'function ' + x.name : typeof x === 'object' && x ? Object.prototype.toString.call(x) : typeof x === 'bigint' ? x + 'n' : Object.is(x, -0) ? '-0' : String(x); } catch (e) { t = 'odd'; } out.push(t); };
function d(x, y) { return ((x | 0) + (y | 0)) & 255; }
const s = 'abc';
let later = null;
function use(i, n) { for (let k = 0; k < 6; k++) { i += k;
  n = d(n + i, 2);
  n = (n + s.length + s.charCodeAt(i % 3)) | 0;
  } return n; }
function ask(i, n) { return [d(i, d(1, n)) | 0, s + n].join(); }
const run = (t, a) => { var fresh = 1; return eval(t); };
function within(o2, t) { with (o2) { return eval(t); } }
const texts = ['d = Math.max', 's = null', "if (false) { s = ['q']; } 8", 'd = function (x) { return x * 2 & 511; }', "s = ['q']", 'typeof fresh', '[typeof d, typeof s].join()', 'eval("s = [\'q\']")'];
let total = 0; for (let i = 0; i < 13 * (texts.length + 2); i++) {
  try { total = use(i, total & 0xffff); say(total); } catch (e) { say(e.name); total = i; }
  if (i % 13 === 12) { const t = texts[(i / 13) | 0]; if (t !== undefined) { try { say(run(t, i)); } catch (e) { say('E ' + e.name); } }
    try { say(ask(i, total & 255)); } catch (e) { say(e.name); }
    if (later && i % 2) { try { say(later()); } catch (e) { say('L ' + e.name); } } }
}
for (const t of ['d = 5', 'typeof d', 'var d = 6', 'hidden = 4', 'delete hidden']) { const o2 = { hidden: 1, d: 2 }; try { say(within(o2, t)); say(JSON.stringify(o2)); } catch (e) { say(e.name); } }
for (const t of ['typeof d', 'typeof s']) say(run(t, 0));
console.log(out.join('\n'));
