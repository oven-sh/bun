const out = [];
const say = x => { let t; try { t = typeof x === 'function' ? 'function ' + x.name : typeof x === 'object' && x ? Object.prototype.toString.call(x) : typeof x === 'bigint' ? x + 'n' : Object.is(x, -0) ? '-0' : String(x); } catch (e) { t = 'odd'; } out.push(t); };
let l = [1, 2, 3, 4];
function d(x, y) { return ((x | 0) + (y | 0)) & 255; }
var m = new Map([[1, 2]]);
let later = null;
function use(i, n) { 
  l[i & 3] = i; n = (n + l[(i + 1) & 3]) | 0;
  n = d(n + i, 2);
  m.set(i & 3, i); n = (n + (m.get(1) | 0)) | 0;
   return n; }
function ask(i, n) { return [n + l.length + l[2], d(i, d(1, n)) | 0, m.size + n].join(); }
const host = { run(t, a) { let w = 2; return eval(t); } }; const run = (t, a) => host.run(t, a);
function aliased(a, t) { const r = eval(t); return String(a) + '|' + String(arguments[0]) + '|' + r; }
const texts = ['m = new Set([4])', 'l = { 0: 1, 1: 2, 2: 3, 3: 4, length: 9 }', 'd = async function () { return 1; }', 'l = new Float32Array(4)', 'typeof fresh', 'var i = 99', 'd = Math.max', 'm.clear()', 'try { m.get = () => 5; } finally { later = null; }', "new Function('return typeof m')()"];
let total = 0; for (let i = 0; i < 7 * (texts.length + 2); i++) {
  try { total = use(i, total & 0xffff); say(total); } catch (e) { say(e.name); total = i; }
  if (i % 7 === 6) { const t = texts[(i / 7) | 0]; if (t !== undefined) { try { say(run(t, i)); } catch (e) { say('E ' + e.name); } }
    try { say(ask(i, total & 255)); } catch (e) { say(e.name); }
    if (later && i % 2) { try { say(later()); } catch (e) { say('L ' + e.name); } } }
}
for (const t of ['a = 7', 'arguments[0] = 8', 'var a = 9', 'a', 'arguments.length']) { try { say(aliased(1, t)); } catch (e) { say(e.name); } }
for (const t of ['typeof l', 'typeof d', 'typeof m']) say(run(t, 0));
console.log(out.join('\n'));
