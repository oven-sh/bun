// The parts of a result of one of two forms live across a yield with nothing tested in front of it.
function form(n) {
  if (n % 2) return { a: { deep: n }, b: "text" + n };
  return { c: n + 0.5, d: [n], e: n };
}
function* whole(n) { const x = form(n); yield "one"; Bun.gc(true); yield JSON.stringify(x); }
function* twoOfThem(n) { const x = form(n), y = form(n + 1); yield "one"; yield JSON.stringify(y); Bun.gc(true); yield JSON.stringify(x); }
function* inALoop(n) { let x = form(n); for (let i = 0; i < 3; i++) { yield i; x = form(n + i); } yield JSON.stringify(x); }
function lit(n) { if (n % 2) return { s: n % 4 === 1 ? "lit" : "eral", t: n > 5 }; return { u: n | 0, v: n / 4 }; }
function* literals(n) { const x = lit(n); yield "one"; yield JSON.stringify(x); }
function orNothing(n) { if (n % 3 === 0) return undefined; if (n % 3 === 1) return { k: [n] }; return { l: "l" + n, m: { n } }; }
function* maybe(n) { const x = orNothing(n); yield "one"; Bun.gc(true); yield JSON.stringify(x) ?? "nothing"; }
const kept = [];
for (const f of [whole, twoOfThem, inALoop, literals, maybe])
  for (let n = 0; n < 24; n++) { const it = f(n); it.next(); kept.push(it); }
const junk = []; for (let i = 0; i < 20000; i++) junk.push({ i }, [i], "j" + i);
Bun.gc(true);
for (const it of kept) console.log([...it].join(" | "));
for (const f of [whole, twoOfThem, inALoop, literals, maybe]) console.log([...f(process.argv.length)].join(" | "), [...f(process.argv.length + 1)].join(" | "));
console.log(junk.length);
