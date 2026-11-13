// lastIndex is stored and read again in loops, off patterns, records and anything else.
// STATISTIC: ReadsForwardedFromStores >= 1
function* turns(n) { for (let i = 0; i < n; i++) yield i; }
function text(re, t) { let s = ""; for (const m of turns(t.length)) { re.lastIndex = 0; s += re.lastIndex; } return s; }
function sum(re, n) { let s = 0; for (const m of turns(n)) { re.lastIndex = m; s += re.lastIndex; } return s; }
function kept(re, n) { const out = []; for (let i = 0; i < n; i++) { re.lastIndex = i * 2; out.push(re.lastIndex); re.lastIndex = -i; if (re.lastIndex < 0) out.push("below"); } return out.join(); }
function steps(re, t) { let s = ""; re.lastIndex = 0; for (let m; (m = re.exec(t));) { re.lastIndex = m.index + 1; s += re.lastIndex + m[0]; } return s; }
function marks(all) { let s = ""; for (const o of all) { o.mark = s.length; s += o.mark; o.lastIndex = 3; s += o.lastIndex; } return s; }
const record = JSON.parse('{"lastIndex":7,"mark":1}'), sealed = Object.freeze(/x/g), getter = Object.defineProperty(JSON.parse("{}"), "lastIndex", { get: () => "got", set: () => { } });
for (const t of ["abab", "x", ""]) {
  for (const make of [() => /a(b)?/g, () => /b/y, () => record, () => getter, () => [1], () => sealed, () => new Proxy(/a/g, {}), () => 5]) {
    const out = [];
    for (const f of [() => text(make(), t), () => sum(make(), 9), () => kept(make(), 4)]) { try { out.push(f()); } catch (e) { out.push(e.constructor.name); } }
    console.log(t, out.join(" | "));
  }
  console.log(steps(/a(b)?/g, t), marks([record, /q/g, JSON.parse('{"lastIndex":1}'), getter]));
}
