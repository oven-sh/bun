const show = v => Object.is(v, -0) ? '-0' : typeof v === 'object' && v ? JSON.stringify(v) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? 'sym' : typeof v === 'function' ? 'fn' : String(v);
const lines = [];
const say = (...a) => { lines.push(a.map(show).join(' ')); };
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ': ' + e.message; } };
const captured = k => { let c = 0; return function (a) { c += k; return [c, a]; }; };
const callees = [function () { return 'z' + arguments.length; }, function (a) { return [this === undefined ? 'u' : typeof this, a]; }, function (a, b) { return [typeof this, a, b]; }, (a, b, c) => [a, b, c], function (a, b, c, d) { return [a, b, c, d]; }, function (a, b, c, d, e) { return [a, b, c, d, e]; }, (...r) => r, (a = 'd', b = a) => [a, b], captured(7), Object.assign(function (a) { return ['p', a]; }, { x: 1 }), (function (a, b) { return [typeof this, a, b]; }).bind({ q: 1 }, 'bound'), class A { constructor(a) { this.a = a; } }, Math.max, String, Boolean, Number, Array.isArray, new Proxy(function (a) { return ['proxy', a]; }, {}), new Proxy(() => 1, { apply: (t, s, r) => ['trap', r.length] }), function* g(a) { yield a; }, undefined, null, 1, 'x', {}, [], Symbol.iterator, 1n, true, 0.5];
const shown = got => (got && typeof got === 'object' && !Array.isArray(got) ? Object.prototype.toString.call(got) : got);
const holders = callees.map(m => ({ m, t: 1 }));
function plain0(f) { 'use strict'; const got = f(); return shown(got); }
function tail0(f) { return f(); }
function method0(o) { return o.m(); }
function loop0(f, n) { let last; for (let i = 0; i < n; i++) last = f(); return shown(last); }
function plain1(f) { 'use strict'; const got = f(1); return shown(got); }
function tail1(f) { return f(1); }
function method1(o) { return o.m(1); }
function loop1(f, n) { let last; for (let i = 0; i < n; i++) last = f(1); return shown(last); }
function plain2(f) { 'use strict'; const got = f(1, 'b'); return shown(got); }
function tail2(f) { return f(1, 'b'); }
function method2(o) { return o.m(1, 'b'); }
function loop2(f, n) { let last; for (let i = 0; i < n; i++) last = f(1, 'b'); return shown(last); }
function plain3(f) { 'use strict'; const got = f(1, 'b', 2.5); return shown(got); }
function tail3(f) { return f(1, 'b', 2.5); }
function method3(o) { return o.m(1, 'b', 2.5); }
function loop3(f, n) { let last; for (let i = 0; i < n; i++) last = f(1, 'b', 2.5); return shown(last); }
function plain4(f) { 'use strict'; const got = f(1, 'b', 2.5, null); return shown(got); }
function tail4(f) { return f(1, 'b', 2.5, null); }
function method4(o) { return o.m(1, 'b', 2.5, null); }
function loop4(f, n) { let last; for (let i = 0; i < n; i++) last = f(1, 'b', 2.5, null); return shown(last); }
for (let round = 0; round < 3; round++) for (let i = 0; i < callees.length; i++) {
    say(i, 0, tried(() => plain0(callees[i])), tried(() => shown(tail0(callees[i]))), tried(() => shown(method0(holders[i]))), tried(() => loop0(callees[i], 5)));
    say(i, 1, tried(() => plain1(callees[i])), tried(() => shown(tail1(callees[i]))), tried(() => shown(method1(holders[i]))), tried(() => loop1(callees[i], 5)));
    say(i, 2, tried(() => plain2(callees[i])), tried(() => shown(tail2(callees[i]))), tried(() => shown(method2(holders[i]))), tried(() => loop2(callees[i], 5)));
    say(i, 3, tried(() => plain3(callees[i])), tried(() => shown(tail3(callees[i]))), tried(() => shown(method3(holders[i]))), tried(() => loop3(callees[i], 5)));
    say(i, 4, tried(() => plain4(callees[i])), tried(() => shown(tail4(callees[i]))), tried(() => shown(method4(holders[i]))), tried(() => loop4(callees[i], 5)));
}
console.log(lines.join('\n'));
