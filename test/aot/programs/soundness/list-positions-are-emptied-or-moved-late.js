// Indexes, positions and lengths of lists, and index keys on plain objects.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
// 1: a position is read, then emptied by length, pop, shift, splice, delete, fill, sort, reverse, copyWithin
{ function first(v) { return v[0]; } function second(v) { return v[1]; }
  const a = [1, "b"]; show("1a", first(a) + 1, second(a).length); chain(a).length = 0; show("1b", first(a), second(a));
  const b = [1, "b"]; chain(b).pop(); show("1c", second(b)); const c = [1, "b"]; chain(c).shift(); show("1d", first(c).length, second(c));
  const d = [1, "b"]; chain(d).reverse(); show("1e", first(d).length, second(d) + 1); const e = [1, "b"]; delete chain(e)[0]; show("1f", first(e), 0 in e);
  const f = [1, "b"]; chain(f).splice(0, 1); show("1g", first(f).length); const g = [1, "b"]; chain(g).fill(null); show("1h", first(g), second(g));
  const h = [2, 1]; chain(h).sort(); show("1i", first(h) + 1); const i = [1, "b"]; chain(i).copyWithin(0, 1); show("1j", first(i).length); const j = [1, "b"]; chain(j).unshift([0]); show("1k", first(j).length, second(j) + 1); }
// 2: an index beyond the literal
{ function at(v, i) { return v[i]; } const a = [1]; show("2a", at(a, 0) + 1, at(a, 5)); chain(a)[5] = "far"; show("2b", at(a, 5).length, a.length, at(a, 3)); }
// 4: index keys of a plain object, as number and as string
{ const o = { 0: "zero" }; function at(v, i) { return v[i]; } show("4a", at(o, 0).length, at(o, "0").length); chain(o)[1] = 1; chain(o)["2"] = [2]; show("4b", at(o, 1) + 1, at(o, "1") + 1, at(o, 2).length, Object.keys(o).join()); }
// 5: an accessor under an index
{ const a = [1, 2]; function at(v, i) { return v[i]; } show("5a", at(a, 0) + 1); Object.defineProperty(chain(a), 0, { get() { return "getter"; } }); show("5b", at(a, 0).length, at(a, 1) + 1); }
// 7: length is stored, defined, read under a key that grows
{ const a = [1, 2, 3]; function g(v, k) { return v[k]; } show("7a", g(a, 0) + 1); show("7b", g(a, chain("length")) + 1); function s(v, k, x) { v[k] = x; } s(a, chain("length"), 1); show("7c", a.length, g(a, 2), g(a, 0) + 1); }
// 8: arguments and rest lists
{ function f() { return arguments[1]; } show("8a", f(1), f(1, "two").length); function g(...rest) { return rest[1]; } show("8b", g(1), g(1, chain("two")).length); }
// 9: typed arrays: out of range, and names that look like numbers
{ const t = new Uint8Array(2); function at(v, i) { return v[i]; } t[0] = 300; show("9", at(t, 0), at(t, 5), at(t, "-1"), at(t, "1.5"), at(t, chain("length"))); }
// 10: destructuring and spreading after a late change of a position
{ const a = [1, "b"]; const take = (v) => { const [x, y] = v; return typeof x + typeof y; }; show("10a", take(a)); chain(a)[0] = null; chain(a).push(3); show("10b", take(a), [...a].length); }
