function looks(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.lid + work; }
function mayThrow(i) { let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; if (i % 3 === 0) throw new RangeError("full"); return work; }
function make(i) {
  let n = 0;
  const o = { lid: i, rim: i + 1 };
  try {
    const p = { lid: i * 2, rim: i + 7 };
    if (i & 1) n = looks(o); else n = looks(p);
    for (let k = 0; k < 2; k++) { if (k & 1) n += 1; else n += 2; }
    n += mayThrow(i);
    return n;
  } catch (e) { n += o.rim; } finally { n += o.lid; }
  return n + o.rim;
}
function second(i) {
  let kept = null, n = 0;
  try {
    kept = { lid: i, rim: i + 1 };
    if (i & 1) n = 1; else n = 2;
    n += mayThrow(i);
  } catch (e) { n += kept.rim; }
  return n;
}
function drive() { let sum = 0; for (let t = 0; t < 12; t++) sum += make(t) * 3 + second(t); return sum; }
console.log(drive());
