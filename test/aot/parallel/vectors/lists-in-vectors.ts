// Loops over lists of doubles that run two elements a vector: their answers by bits where an element is a hole, NaN or no number, and where lists share their elements.
const B = new DataView(new ArrayBuffer(8));
function show(v: ArrayLike<number>) {
  let t = 17, h = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!(i in v)) { h++; continue; }
    if (typeof x !== "number" || x !== x) { t = (Math.imul(t, 31) + String(x).length) | 0; continue; }
    B.setFloat64(0, x);
    t = (Math.imul(t, 31) + B.getInt32(0)) | 0;
    t = (Math.imul(t, 31) + B.getInt32(4)) | 0;
  }
  return v.length + ":" + h + ":" + t;
}
function scale(x: number[], k: number) { for (let i = 0; i < x.length; i++) x[i] *= k; }
function addScaled(x: number[], y: number[], k: number) { for (let i = 0; i < x.length; i++) y[i] += k * x[i]; }
function shift(x: number[], y: number[], n: number, d: number) { for (let i = 8; i < n; i++) y[i] = x[i - d] * 0.5 + x[i]; }
function rows(a: number[], b: number[], w: number, h: number) {
  for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) b[j * w + i] = 0.25 * (a[j * w + i - 1] + a[j * w + i + 1] + a[(j - 1) * w + i] + a[(j + 1) * w + i]);
}
function twoStores(u: number[], d: number[], p: number[], n: number) { let c = -1; for (let i = 0; i < n; i++) { d[++c] = -0.5 * u[c]; p[c] = 0; } }
function fill(n: number, how: number): number[] {
  const l: number[] = new Array(n);
  for (let i = 0; i < n; i++) l[i] = how === 0 ? i * 0.37 - 4 : how === 1 ? Math.sin(i) : how === 2 ? i : i & 1 ? -0 : 1e-310;
  return l;
}
const spoilers: [string, (x: any) => void][] = [
  ["as it is", () => {}], ["hole", x => { delete x[21]; }], ["NaN", x => { x[19] = NaN; }], ["infinities", x => { x[18] = Infinity; x[20] = -Infinity; }], ["string", x => { x[25] = "3"; }],
  ["object", x => { x[23] = { valueOf() { return 2; } }; }], ["short", x => { x.length = 17; }], ["frozen", x => { Object.freeze(x); }], ["last", x => { x[39] = NaN; }], ["first", x => { delete x[0]; }],
];
for (const [name, spoil] of spoilers) {
  for (let how = 0; how < 4; how++) {
    const x = fill(40, how), y = fill(40, 1), z = fill(40, how), p = fill(40, 1), d = fill(40, 0);
    spoil(x); spoil(z);
    const answers: string[] = [];
    const attempt = (run: () => void) => { try { run(); } catch (e: any) { answers.push(e.name); } answers.push(show(x), show(y), show(z), show(p), show(d)); };
    attempt(() => scale(x, 1.5));
    attempt(() => addScaled(x, y, -0.25));
    attempt(() => addScaled(z, z, 3));
    for (const distance of [0, 1, 2, 3, 7, 8]) attempt(() => shift(z, z, 40, distance));
    for (const distance of [0, 1, 5]) attempt(() => shift(x, y, 40, distance));
    attempt(() => twoStores(x, d, p, 40));
    attempt(() => twoStores(x, x, p, 33));
    attempt(() => twoStores(y, z, z, 37));
    console.log(name, how, answers.join(" "));
  }
}
for (const [w, h] of [[3, 3], [18, 5], [19, 5], [34, 4], [64, 6]]) {
  const a = fill(w * h, 1), b = fill(w * h, 0);
  rows(a, b, w, h); console.log(w, h, show(b));
  rows(a, a, w, h); console.log(w, h, show(a));
  delete a[w + 9]; rows(a, b, w, h); console.log(w, h, show(b));
  b.length = w * 2; rows(a, b, w, h); console.log(w, h, show(b));
}
