// charCodeAt past the end gives NaN, and NaN | 0 is zero: the comparison sees the zero.
function greater(s, k, at) { return (k | 0) > (s.charCodeAt(at) | 0); }
function less(s, k, at) { return k < (s.charCodeAt(at) | 0); }
function isZero(s, at) { return (s.charCodeAt(at) | 0) === 0; }
function isOther(s, at) { return (s.charCodeAt(at) | 0) !== 0; }
function isFalse(s, at) { return !(s.charCodeAt(at) | 0); }
function unsigned(s, at) { return s.charCodeAt(at) >>> 0 < 5; }
function shifted(s, at) { return s.charCodeAt(at) << 0 < 5 && s.charCodeAt(at) >> 0 < 5; }
function masked(s, at) { return (s.charCodeAt(at) & 255) < 5; }
function branched(s, at) { if ((s.charCodeAt(at) | 0) < 5) return 1; return 2; }
function kept(s, k, at) { const c = s.charCodeAt(at) | 0; return k >= c ? c : -1; }
function counted(s, at) { let n = 0; for (let i = 0; i < 4; i++) if ((s.charCodeAt(at + i) | 0) < 50) n++; return n; }
function equal(s, t, at) { return (s.charCodeAt(at) | 0) === (t.charCodeAt(at) | 0); }
function switched(s, at) { switch (s.charCodeAt(at) | 0) { case 0: return "zero"; case 98: return "b"; } return "other"; }
function plain(s, at) { return [s.charCodeAt(at) < 5, s.charCodeAt(at) > 5, s.charCodeAt(at) === 0, s.charCodeAt(at) !== s.charCodeAt(at)].join(); }
for (let round = 0; round < 3; round++)
  for (const s of ["ab", "b", "", "a\0"]) for (const at of [1, 0, -1, 1.5, NaN])
    console.log(JSON.stringify(s), at, greater(s, 3, at), less(s, -1, at), isZero(s, at), isOther(s, at), isFalse(s, at), unsigned(s, at), shifted(s, at), masked(s, at), branched(s, at), kept(s, 3, at), counted(s, 0), equal(s, "c", at), switched(s, at), plain(s, at));
