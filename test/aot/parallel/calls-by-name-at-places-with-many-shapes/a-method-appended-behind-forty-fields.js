// The method is the forty-first field that is appended: it lies far out in what the object holds beside its cell. One written call by name, `r.m(..)`, on a receiver that nobody knows, at a place that sees more than two shapes, so that the call goes past what the place remembers. A fresh object for each of sixteen histories of the method; three rounds before and three behind.
function make() { const o = { a: 1 }; o.p0 = 0; o.p1 = 1; o.p2 = 2; o.p3 = 3; o.p4 = 4; o.p5 = 5; o.p6 = 6; o.p7 = 7; o.p8 = 8; o.p9 = 9; o.p10 = 10; o.p11 = 11; o.p12 = 12; o.p13 = 13; o.p14 = 14; o.p15 = 15; o.p16 = 16; o.p17 = 17; o.p18 = 18; o.p19 = 19; o.p20 = 20; o.p21 = 21; o.p22 = 22; o.p23 = 23; o.p24 = 24; o.p25 = 25; o.p26 = 26; o.p27 = 27; o.p28 = 28; o.p29 = 29; o.p30 = 30; o.p31 = 31; o.p32 = 32; o.p33 = 33; o.p34 = 34; o.p35 = 35; o.p36 = 36; o.p37 = 37; o.p38 = 38; o.p39 = 39; o.m = (x0) => "first" + x0; return o; }
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
