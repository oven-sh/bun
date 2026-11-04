// One value that is alive where several guesses fail, under types that get narrower, in forms whose boxing goes by the type; and a hot path without a call.
function openTheWorld(): unknown { return eval("1"); }
type Host = { a: number; s: string; log: (x: number) => void };
type Pair = { x: number; y: number };
let seen = 0, calls = 0, breakAt = 0;
const host: any = { a: 1, s: "s", log(x: number) { seen += x; if (++calls === breakAt) host.a = "one"; } };
function fresh(at: number) { host.a = 1; calls = 0; breakAt = at; }
export function narrower(x: number | undefined, big: number, h: Host, w: number | null, p0: string, p1: number, p2: string, p3: number, p4: string, p5: number) {
  let r = 0;
  let whole = Math.floor(big) * 3;
  h.log(1); r += h.a;
  if (x !== undefined) {
    h.log(2); r += h.a + x;
    if (x > 0 && x < 100) { h.log(3); r += h.a + x; }
  }
  if (whole >= 0 && whole < 1000) { h.log(4); r += h.a + whole; }
  h.log(5); r += h.a;
  if (w !== null) { h.log(6); r += h.a + w; }
  h.log(7); r += h.a;
  return [r, x, big, whole, w, p0, p1, p2, p3, p4, p5].join(" ");
}
export function stores(o: Pair, q: Pair, a: number, b: number, c: number, d: number, e: number, f: number, g: number, i: number, j: number, k: number) {
  o.x = a + q.x;
  o.y = b + q.y;
  o.x += c * q.x;
  o.y += d * q.y;
  o.x += e * q.x;
  o.y += f * q.y;
  o.x += g * q.x;
  o.y += i * q.y;
  return a + b + c + d + e + f + g + i + j + k + o.x + o.y;
}
openTheWorld();
Object.assign(globalThis as any, { narrower, stores });
for (let at = 0; at < 9; at++) for (const x of [undefined, 5, 500, -0, NaN, 0.5]) for (const big of [1.5, 100.5, 3e9, 4e15, -7.5]) for (const w of [null, 2, 2 ** 40]) {
  fresh(at); console.log(at, narrower(x, big, host, w, "P", 1.5, "Q", 2, "R", -0), seen);
}
function pair(kind: number, turn: number): Pair {
  const p: any = { x: 1.5, y: 2 };
  let reads = 0;
  if (kind === 1) p.x = "x";
  if (kind === 2) p.y = "y";
  if (kind === 3) Object.defineProperty(p, "x", { get() { return ++reads > turn ? "late" : 1; } });
  if (kind === 4) Object.defineProperty(p, "y", { get() { return ++reads > turn ? undefined : 2; } });
  if (kind === 5) delete p.y;
  return p;
}
for (let kind = 0; kind < 6; kind++) for (let turn = 0; turn < 5; turn++) {
  const o = { x: 0, y: 0 };
  console.log(kind, turn, stores(o, pair(kind, turn), 1, 2.5, 3, -0, 5e15, 6, 7, 8, 9, 10), o.x, o.y);
  const same: any = pair(kind === 3 || kind === 4 ? 0 : kind, turn);
  console.log(kind, turn, stores(same, same, 1, 2.5, 3, -0, 5e15, 6, 7, 8, 9, 10), same.x, same.y);
}
