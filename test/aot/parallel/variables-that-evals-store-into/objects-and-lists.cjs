const out = [];
const say = x => { let t; try { t = typeof x === 'function' ? 'function ' + x.name : typeof x === 'object' && x ? Object.prototype.toString.call(x) : typeof x === 'bigint' ? x + 'n' : Object.is(x, -0) ? '-0' : String(x); } catch (e) { t = 'odd'; } out.push(t); };
const s = 'abc';
const m = new Map([[1, 2]]);
let o = { a: 1, b: 2 };
const v = new Int32Array(16);
let later = null;
function use(i, n) { 
  n = (n + s.length + s.charCodeAt(i % 3)) | 0;
  m.set(i & 3, i); n = (n + (m.get(1) | 0)) | 0;
  o.a = i & 7; n = (n + o.a + o.b) | 0;
  v[i & 15] = i * 3; n = (n + v[(i * 5) & 15]) | 0;
   return n; }
function ask(i, n) { return [s + n, m.size + n, n + o.a * o.b, n + v[i & 3] + v.length].join(); }
const run = (t, a) => { let w = 2; return eval(t); };
function aliased(a, t) { const r = eval(t); return String(a) + '|' + String(arguments[0]) + '|' + r; }
const texts = ['s = 5', '1 + 1', "s = ''", '(() => { try { undeclaredName; } catch (e) { return e.name; } })()', 'var i = 99', 'o = [1, 2]', 'this === undefined', 'v = new Float64Array(16)', "o.a = 'z'", 'm = new Set([4])', 'm.get = () => 5', 'v = null'];
let total = 0; for (let i = 0; i < 7 * (texts.length + 2); i++) {
  try { total = use(i, total & 0xffff); say(total); } catch (e) { say(e.name); total = i; }
  if (i % 7 === 6) { const t = texts[(i / 7) | 0]; if (t !== undefined) { try { say(run(t, i)); } catch (e) { say('E ' + e.name); } }
    try { say(ask(i, total & 255)); } catch (e) { say(e.name); }
    if (later && i % 2) { try { say(later()); } catch (e) { say('L ' + e.name); } } }
}
for (const t of ['a = 7', 'arguments[0] = 8', 'var a = 9', 'a', 'arguments.length']) { try { say(aliased(1, t)); } catch (e) { say(e.name); } }
for (const t of ['typeof s', 'typeof m', 'typeof o', 'typeof v']) say(run(t, 0));
console.log(out.join('\n'));
