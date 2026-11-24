const out = [];
const say = x => { let t; try { t = typeof x === 'function' ? 'function ' + x.name : typeof x === 'object' && x ? Object.prototype.toString.call(x) : typeof x === 'bigint' ? x + 'n' : Object.is(x, -0) ? '-0' : String(x); } catch (e) { t = 'odd'; } out.push(t); };
function P(x) { this.x = x; } P.prototype.get = function () { return this.x; };
var p = new P(3);
let later = null;
function use(i, n) { for (let k = 0; k < 6; k++) { i += k;
  p.x = i; n = (n + p.get()) | 0;
  } return n; }
function ask(i, n) { return [p.get() + n].join(); }
function run(t, a) { var fresh = 1; const r = eval(t); return r; }
const texts = ['p = null', 'delete p', 'if (false) { p = null; } 8', 'P = function (x) { this.x = x + 1; this.get = () => this.x; }; p = new P(8)', '(function () { p = null; })()', 'class Z { static z = 4; } Z.z'];
let total = 0; for (let i = 0; i < 29 * (texts.length + 2); i++) {
  try { total = use(i, total & 0xffff); say(total); } catch (e) { say(e.name); total = i; }
  if (i % 29 === 28) { const t = texts[(i / 29) | 0]; if (t !== undefined) { try { say(run(t, i)); } catch (e) { say('E ' + e.name); } }
    try { say(ask(i, total & 255)); } catch (e) { say(e.name); }
    if (later && i % 2) { try { say(later()); } catch (e) { say('L ' + e.name); } } }
}
for (const t of ['typeof p']) say(run(t, 0));
console.log(out.join('\n'));
