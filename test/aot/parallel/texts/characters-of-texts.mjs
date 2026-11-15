// The characters of texts of every kind, asked for their unit, code point, equality, order and length; switches over them; loops broken off; texts that are lists.
const f = (s, r = []) => { for (const c of s) r.push(c.charCodeAt(0), c.codePointAt(0), c === "\u{1F600}", c < "b", c < "\uE000", c.length); return r.join(); };
const g = s => { let k = 0; for (const c of s) switch (c) { case "\u{1F600}": k += 100; break; case "\uD83D": k += 10; break; case "\uE000": k += 1000; break; case "ab": k += 5000; break; default: k++; } return k; };
const h = v => { let n = ""; for (const c of v) { n = c + n; if (n.length > 3) break; } return n; };
for (let r = 0; r < 20; r++) { const o = []; for (const s of ["a\u{1F600}", "\uD83Dz", "", "z\uD83D", "\uDE00a", "\uE000b", "e\u0301", "a".repeat(40) + "\u{1F600}b"]) o.push(f(s), g(s)); o.push(h("abcdef"), h(["p", "q"]), h(new Set("xyx")), h("\u{1F600}b")); if (r === 19) console.log(o.join("|")); }
