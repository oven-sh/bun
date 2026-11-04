type P = { a: number; b?: number; c?: number; d?: number };
function make(i: number): P { const p: P = { a: i }; if (i & 1) p.d = 4; if (i & 2) p.b = 2; if (i & 4) p.c = 3; return p; }
for (let i = 0; i < 8; i++) {
  const p = make(i); const s = { ...p };
  console.log(i, Object.keys(p).join(""), Object.keys(s).join(""), JSON.stringify(p), JSON.stringify(s), s.a, s.b, s.c, s.d, "d" in s, Object.getOwnPropertyNames(s).join(""));
}
