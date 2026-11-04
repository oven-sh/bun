const N = 20000, fns = [];
for (let i = 0; i < N; i++) {
  const f = () => i;
  if (i & 1) f.p0 = 0;
  if (i & 2) f.p1 = 1;
  if (i & 4) f.p2 = 2;
  if (i & 8) f.p3 = 3;
  if (i & 16) f.p4 = 4;
  if (i & 32) f.p5 = 5;
  if (i & 64) f.p6 = 6;
  if (i & 128) f.p7 = 7;
  if (i & 256) f.p8 = 8;
  if (i & 512) f.p9 = 9;
  if (i & 1024) f.p10 = 10;
  if (i & 2048) f.p11 = 11;
  if (i & 4096) f.p12 = 12;
  if (i & 8192) f.p13 = 13;
  if (i & 16384) f.p14 = 14;
  if (i % 3 === 0) f.tag = 7;
  fns.push(f);
}
const rows = JSON.parse("[" + Array.from({ length: N }, (_, i) => '{"qa":' + i + "}").join() + "]");
function run(rows, fns, n) {
  let s = 0;
  for (let k = 0; k < n * 20; k++) {
    const i = (k / 20) | 0;
    const row = rows[i], f = fns[i];
    const x = row.qa, t = f.tag;
    s += x + (t === undefined ? 0 : t);
  }
  return s;
}
console.log(run(rows, fns, N));
