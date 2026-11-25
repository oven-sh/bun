// Loops that reckon with what they read by name off unknown objects and store in between: getters, setters, proxies, valueOf, texts, bigints, nothing, prototypes, shared, frozen and replaced objects.
const log = []; let effects = 0;
function show(v) { return typeof v === "number" ? (Object.is(v, -0) ? "-0" : Number.isInteger(v) ? String(v) : v.toPrecision(12)) : typeof v === "bigint" ? v + "n" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "{" + Object.keys(v).slice(0, 7).map(k => { let d = Object.getOwnPropertyDescriptor(v, k); return k + (d && d.get ? "!" : "=" + (typeof d?.value === "object" && d.value ? "o" : show(d?.value))); }).join(",") + "}" : String(v); }
const V = (x, y) => Object.assign(JSON.parse('{"x":0,"y":0}'), { x, y });
class K { constructor(x, y) { this.x = x; this.y = y; } get sum() { return this.x + this.y; } }
const W = (x, y) => x > 1 ? V(x, y) : new K(x, y);
const P = i => Object.assign(JSON.parse('{"near":0,"far":0,"m":0,"n":0,"k":0}'), { near: W(i * 0.5 + 0.25, 0.75), far: W(1.5, i * 0.25), m: 0.5 + i, n: i % 3, k: i });
let points, body;
function renew() { points = JSON.parse("[0,1,2,3,4,5]").map(P); body = JSON.parse('{"v":0,"w":0,"J":0.5,"T":2}'); body.v = W(1, 2); body.w = W(3, 4); body.next = body; }
const changes = {
  plain() {},
  getter() { Object.defineProperty(points[3], "m", { get() { effects++; body.v.x += 1; return 2; }, configurable: true, enumerable: true }); },
  deepgetter() { Object.defineProperty(points[2].far, "y", { get() { effects++; points[4].m = 7; return effects; }, set(v) { effects += 10; }, configurable: true, enumerable: true }); },
  setter() { let held = 0; Object.defineProperty(body.v, "x", { get() { effects++; return held; }, set(v) { effects += 100; held = v + 1; }, configurable: true, enumerable: true }); },
  proxy() { points[1] = new Proxy(points[1], { get(t, k) { effects++; return t[k]; }, set(t, k, v) { effects += 5; t[k] = v; return true; } }); },
  proxyDeep() { points[4].near = new Proxy(points[4].near, { get(t, k) { effects++; if (k === "x") body.w.y = 9; return t[k]; } }); },
  text() { points[2].m = "3"; }, textDeep() { points[3].near.y = "q"; }, bigint() { points[3].n = 5n; }, bigintDeep() { body.w.y = 7n; },
  nothing() { delete points[2].m; }, nothingDeep() { points[4].far = undefined; }, nullDeep() { points[5].near = null; }, hole() { delete points[3]; },
  value() { points[1].m = { valueOf() { effects++; body.v.y += 0.5; points[3].m = effects; return 4; } }; },
  toPrimitive() { body.w.x = { [Symbol.toPrimitive]() { effects++; body.v = W(9, 8); return 1; } }; },
  proto() { Object.setPrototypeOf(points[2], { m: 11, z: 1 }); delete points[2].m; }, protoGetter() { Object.setPrototypeOf(points[4].far, { get x() { effects++; return this.y * 2; } }); delete points[4].far.x; },
  shared() { body.w = body.v; points[2].near = body.v; points[3].far = points[3].near; }, self() { points[1].near = points[1]; points[1].x = 1; points[1].y = 2; },
  frozen() { Object.freeze(body.v); }, frozenPoint() { Object.freeze(points[2]); }, extended() { points[3].extra = 1; points[4].near.z = 1; body.v.q = 2; },
  symbol() { points[4].m = Symbol("s"); }, boolean() { points[4].n = true; points[1].m = null; }, infinite() { points[2].m = Infinity; points[3].near.x = NaN; points[4].far.y = -0; },
  dictionary() { for (let i = 0; i < 80; i++) points[2]["d" + i] = i; delete points[2].d3; }, array() { points[3] = [1, 2, 3]; }, func() { points[4].near = function () {}; }, number() { points[2].far = 5; },
  replaced() { Object.defineProperty(points[2], "k", { get() { points[3] = P(9); points[5].m = 1; return 1; }, set() {}, configurable: true, enumerable: true }); },
};
function clamp(a, b, c) { return a < b ? b : a > c ? c : a; }
function solve(ps, b) { let s = 0.1, t = 0.2; let text = "", u = 0; const v = b.v, w = b.w, J = b.J; for (let i = 0; i < ps.length; i++) { const o = ps[i]; let q = o.near.x * t + w.y - o.far.y * v.x, n = o.far.x - s * w.x + v.y * o.near.y; n = q * 0.25 - n * 0.75; q = n / -o.m; n = o.n + 0.7; q = clamp(q - o.k, n, 4 * n); n = o.k * q; const c = n + 0.4; n = n - 0.1; w.y += J * n; v.x += J * c; t += 0.05 * (o.far.y * c + o.far.x * n); v.y -= 0.06 * n; w.x -= 0.01 * c; s += 0.07 * (o.near.y * n + o.near.x * c); u -= n; o.k = q; } return [show(s), show(t), show(u), text].join(" "); }
function run0(ps, b) { let s = 0, t = 0.5, u = 1, text = "", i = 0; const v = b.v, w = b.w; for (i = 0; i < ps.length; i++) { const o = ps[i]; t = (u * (-b.next.v.y * b.v.y)); s -= o.k; text += o.k + ":" + b.v.y; text += o.k + ":" + b.T; o.n -= b.next.v.y; } return [show(s), show(t), show(u), text.slice(-40)].join(" "); }
function run1(ps, b) { let s = 0, t = 0.5, u = 1, text = "", i = 0; const v = b.v, w = b.w; for (i = 0; i < ps.length; i++) { const o = ps[i]; text += ((-i * o.k)) + ","; text += ((-b.next.v.y * b.next.J)) + ","; t = (v.y * (s - v.x)); b.J *= (o.m - 0.5); t = (s * s); } return [show(s), show(t), show(u), text.slice(-40)].join(" "); }
function run2(ps, b) { let s = 0, t = 0.5, u = 1, text = "", i = 0; const v = b.v, w = b.w; for (i = 0; i < ps.length; i++) { const o = ps[i]; s += (o.n - b.next.J); u = clamp((o.near.x - b.next.v.y), (o.n * o.k), o.k); t = 0.5; o.far.y *= 0.5; o.k = (-(0.5 + i) * (b.next.v.y - o.k)); } return [show(s), show(t), show(u), text.slice(-40)].join(" "); }
function run3(ps, b) { let s = 0, t = 0.5, u = 1, text = "", i = 0; const v = b.v, w = b.w; for (i = 0; i < ps.length; i++) { const o = ps[i]; t -= 2; text += o.k + ":" + o.n; text += o.k + ":" + o.m; b.v = W((-u - b.w.y), 1); u += (o.near.y + 2); } return [show(s), show(t), show(u), text.slice(-40)].join(" "); }
function run4(ps, b) { let s = 0, t = 0.5, u = 1, text = "", i = 0; const v = b.v, w = b.w; for (i = 0; i < ps.length; i++) { const o = ps[i]; t = s; t = ((o.k * i) - (b.w.y * b.T)); if ((o.near.x * b.w.x) > (o.far.y - t)) { t -= (0.5 / (o.m - w.x)); b.v = W((2 - v.y), 1); } else { t = (b.w.x - (o.k / u)); } t += o.near.y; s += ((-(o.m * w.x) - (-s + o.m)) + ((v.x * o.n) / (o.far.y * s))); } return [show(s), show(t), show(u), text.slice(-40)].join(" "); }
function run5(ps, b) { let s = 0, t = 0.5, u = 1, text = "", i = 0; const v = b.v, w = b.w; for (i = 0; i < ps.length; i++) { const o = ps[i]; o.far.y *= v.y; b.v = v; o.far.y += s; u = ((-(b.v.x - o.near.x) - (-w.x / o.n)) + ((0.5 / s) / (o.far.x + b.next.v.y))); u += ((b.w.y / b.T) * s); } return [show(s), show(t), show(u), text.slice(-40)].join(" "); }
function run6(ps, b) { let s = 0, t = 0.5, u = 1, text = "", i = 0; const v = b.v, w = b.w; for (i = 0; i < ps.length; i++) { const o = ps[i]; u -= (-(o.near.x * t) * (o.near.x * s)); o.near.x = (t * (b.next.J - v.y)); s = (b.next.v.y - u); text += o.k + ":" + b.next.J; b.v = v; } return [show(s), show(t), show(u), text.slice(-40)].join(" "); }
for (const run of [solve, run0, run1, run2, run3, run4, run5, run6]) for (const name in changes) { renew(); for (let turn = 0; turn < 2; turn++) try { run(points, body); } catch (error) { log.push(error?.constructor?.name); } effects = 0; try { changes[name](); } catch (error) { log.push("change " + error?.constructor?.name); } for (let turn = 0; turn < 2; turn++) { let said; try { said = run(points, body); } catch (error) { said = "threw " + error?.constructor?.name; } log.push(run.name + " " + name + " " + said + " " + effects + " " + points.map(show).join("") + show(body.v) + show(body.w) + show(body)); } }
console.log(log.join("\n"));
