const holder = { inner: null };
function looks(o) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return o.lid + work; }
function make(i) {
  const o = { lid: i, rim: i + 1 };
  let n = 0;
  if (i & 1) n = looks(o); else { try { n = looks(o) + 1; } catch (e) { n = -1; } }
  for (let k = 0; k < 3; k++) { const p = { lid: k, rim: o.rim }; n += looks(p); }
  return n + o.rim;
}
function drive() { let sum = 0; for (let t = 0; t < 6; t++) sum += make(t); return sum; }
console.log(drive());
