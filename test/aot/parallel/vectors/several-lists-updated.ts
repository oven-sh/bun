// Iterations that update several lists, one after another: the same or other ones, shorter ones, holes, NaN, integers, other values, offsets.
function particles(x: number[], v: number[], dt: number) { for (let i = 0; i < x.length; i++) { x[i] += v[i] * dt; v[i] *= 0.999; } }
function physics(px: number[], py: number[], vx: number[], vy: number[], dt: number) { for (let i = 0; i < px.length; i++) { vy[i] += dt * 9.5; px[i] += vx[i] * dt; py[i] += vy[i] * dt; } }
function chained(a: number[], b: number[], k: number) { for (let i = 0; i < a.length; i++) { a[i] = a[i] * k + 0.1; b[i] = a[i] - b[i]; } }
function neighbors(a: number[], b: number[]) { for (let i = 1; i < a.length; i++) { a[i] = b[i - 1] + 0.5; b[i] = a[i - 1] * 0.5; } }
function swapped(a: number[], b: number[]) { for (let i = 0; i < a.length; i++) { const t = a[i]; a[i] = b[i]; b[i] = t; } }
function shifted(a: number[], b: number[]) { for (let i = 0; i + 1 < a.length; i++) { a[i] = a[i + 1] - b[i]; b[i + 1] = a[i] + 1; } }
const text = (list: unknown[]) => { let s = list.length + ":"; for (let i = 0; i < list.length; i++) if (i < 12 || i > list.length - 4) s += (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "_") + " "; return s; };
const fill = (n: number, how: number) => { const list: number[] = []; for (let i = 0; i < n; i++) list.push(how === 0 ? i * 0.37 - 4 : how === 1 ? i - 3 : how === 2 ? (i & 1 ? -0 : 1e300) : Math.sin(i)); return list; };
const changes: ((list: any[], at: number) => void)[] = [
  () => {}, () => {}, (l, at) => { l[at] = NaN; }, (l, at) => { l[at] = Infinity; }, (l, at) => { delete l[at]; }, (l, at) => { l[at] = "7"; }, (l, at) => { l[at] = undefined; }, (l) => { l.length += 2; }, (l) => { l.length >>= 1; }, (l) => { Object.freeze(l); },
];
for (const n of [0, 1, 7, 8, 16, 17, 24, 40, 100]) {
  for (let how = 0; how < 4; how++) {
    for (let change = 0; change < changes.length; change++) {
      for (const same of [false, true]) {
        const a = fill(n, how), b = same ? a : fill(n, (how + (change & 1)) % 4), c = fill(n, 3), d = fill(n + (change & 1), 0), at = (n * 5) >> 3;
        changes[change](change & 2 ? b : a, at);
        let thrown = "";
        for (const step of [() => particles(a, b, 0.5), () => physics(a, b, c, d, 0.25), () => chained(a, b, 0.75), () => neighbors(a, b), () => swapped(a, b), () => shifted(a, b), () => particles(c, d, 2), () => chained(d, c, -1)]) {
          try { step(); } catch (e) { thrown += (e as Error).name + " "; }
        }
        console.log(n, how, change, same, thrown, text(a), same ? "" : text(b), text(c), text(d));
      }
    }
  }
}
