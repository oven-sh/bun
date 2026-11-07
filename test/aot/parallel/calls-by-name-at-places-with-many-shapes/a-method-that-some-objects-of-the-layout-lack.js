// Every second object of the layout gets the method, the others never do: the field's place is empty there and the call must fail as in plain Bun. One written call by name, `r.m(..)`, on a receiver that nobody knows, at a place that sees more than two shapes, so that the call goes past what the place remembers. A fresh object for each of sixteen histories of the method; three rounds before and three behind.
let turn = 0;
function make() { const o = { a: 1 }; if (turn++ % 2 === 0) o.m = (x0) => "first" + x0; return o; }
class F1 { constructor() { this.f1 = 1; } m(x0) { return "F1" + x0; } }
const fillers = [new F1(), { f2: 1, m: (x0) => "F2" + x0 }, { f3: 1, f4: 2, m: (x0) => "F3" + x0 }, Object.assign(JSON.parse('{"f5":1}'), { m: (x0) => "F4" + x0 })];
function hide(list) { return JSON.parse('[' + list.map((_, i) => i).join(',') + ']').map((i) => list[i]); }
function call(r) { try { return String(r.m(1)); } catch (e) { return e.constructor.name + ': ' + e.message; } }
function round(list) { const out = []; for (let i = 0; i < list.length; i++) out.push(call(list[i])); return out.join(' | '); }
function tell(name, s, change) {
    const list = hide([s, ...fillers]);
    const before = [round(list), round(list), round(list)];
    let failed = '';
    try { change(s); } catch (e) { failed = ' (' + e.constructor.name + ')'; }
    const behind = [round(list), round(list), round(list)];
    console.log(name + failed + ': ' + [...new Set(before)].join(' // ') + ' >> ' + [...new Set(behind)].join(' // '));
}
tell('nothing', make(), (s) => {  });
tell('deleted', make(), (s) => { delete s.m; });
tell('stored-anew', make(), (s) => { s.m = (x0) => "second" + x0; });
tell('stored-a-number', make(), (s) => { s.m = 7; });
tell('stored-undefined', make(), (s) => { s.m = undefined; });
tell('made-a-getter', make(), (s) => { Object.defineProperty(s, 'm', { get() { return (x0) => "second" + x0; }, configurable: true }); });
tell('defined-anew', make(), (s) => { Object.defineProperty(s, 'm', { value: (x0) => "second" + x0, writable: false, enumerable: false, configurable: true }); });
tell('deleted-and-stored', make(), (s) => { delete s.m; s.m = (x0) => "second" + x0; });
tell('stored-and-deleted', make(), (s) => { s.m = (x0) => "second" + x0; delete s.m; });
tell('another-above', make(), (s) => { Object.setPrototypeOf(s, { m: (x0) => "second" + x0 }); });
tell('nothing-above', make(), (s) => { Object.setPrototypeOf(s, null); });
tell('grown', make(), (s) => { for (let i = 0; i < 70; i++) s['z' + i] = i; });
tell('grown-and-deleted', make(), (s) => { for (let i = 0; i < 70; i++) s['z' + i] = i; delete s.m; });
tell('frozen-late', make(), (s) => { Object.freeze(s); });
tell('replaced-above', make(), (s) => { { const p = Object.getPrototypeOf(Object(s)); if (p && p !== Object.prototype && p !== Function.prototype && p !== Array.prototype) p.m = (x0) => "second" + x0; } });
tell('deleted-above', make(), (s) => { { const p = Object.getPrototypeOf(Object(s)); if (p && p !== Object.prototype && p !== Function.prototype && p !== Array.prototype) delete p.m; } });
