// Under: --aot-check=Validate: the lesser of the list's length and the view's length, reckoned in front of the second copy of the loop, read the name that the test of the first copy's body had given the length: the check stopped the build.
function show(x) {
  return JSON.stringify(x);
}
function tell(label, r, L, o) { console.log(label + " " + show(r) + " | " + show(L) + " | " + show(o.start) + " " + show(o.timeout) + " " + show(o.event) + " | " + show(o.source)); }
const TURNS = JSON.parse("2");
let Gf0 = 0;
class Kf0 {
f0(text, b, mode, L, o) {
  let t = 0, u = 0, x = -5;
  try {
  for (Gf0 = 35; ; Gf0 = Gf0 - 1) {
    if (Gf0 + 1 === enabled) { continue; } else { x++; }
  }
  } catch (e) { return ["caught", t, Gf0, u, x]; }
}
}
const kf0 = new Kf0();
function f1(text, b, mode, L, o) {
  let t = 0, x = 0, v = 0, u = 0;
  const P = new Int32Array(8);
  var timeout;
  const enabled = L.length;
  for (timeout = 0; ; timeout++) {
    if (!(timeout < enabled)) break;
    v = L[timeout + 1];
    const more1 = timeout < enabled; if (v === 3) x += more1 ? 1 : 2;
    P[timeout] = timeout - t;
  }
  return [x, v, timeout, P.join()];
}
for (let round = 0; round < TURNS; round++) {
{ const L = new Float64Array([-14.5, 122.5, 139.5, 85.5, 47.5, 46.5, 3, 44.5, -35.5, 19.5, 106.5, 108.5, 24.5, 137.5, 113.5, 79.5, 92.5, 119.5, 130.5, 126.5, 20.5, -5.5, 1.5, -3.5, 92.5, 133.5, 112.5, -43.5, 138.5, -37.5, 86.5, 95.5]), o = { enabled: 34, text: 2, meta: 2, mode: 2, state: 2, start: 0, timeout: 0, event: 0, source: [] }; let r; try { r = kf0.f0(2, 34, 2, L, o); } catch (e) { r = caught(e); } tell("f0.0'", r, L, o); }
{ const L = [], o = { enabled: 0, text: 0, meta: 2, mode: 1, state: 0, start: 0, timeout: 0, event: 0, source: [] }; let r; try { r = f1(0, 0, 1, L, o); } catch (e) { r = caught(e); } tell("f1.1", r, L, o); }
}
