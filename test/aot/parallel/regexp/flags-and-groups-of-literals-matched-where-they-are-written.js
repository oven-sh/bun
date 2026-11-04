// d, v, u, s, m, i and named groups, in literals that are matched with where they are written.
function show(match) {
  if (!match) return String(match);
  return JSON.stringify({ all: [...match], index: match.index, input: match.input, groups: match.groups && { ...match.groups }, indices: match.indices && { all: [...match.indices], groups: match.indices.groups && { ...match.indices.groups } } });
}
function indices(text) { return [show(/b(c)?/d.exec(text)), show(text.match(/(?<first>a)(?<none>x)?/d)), /c/d.test(text), text.search(/c/d)]; }
function named(text) { return [show(/(?<year>\d{4})-(?<month>\d\d)/.exec(text)), show(text.match(/(?<year>\d{4})/)), text.replace(/(?<year>\d{4})-(?<month>\d\d)/, "$<month>/$<year>"), text.replace(/(?<y>\d{4})/, (...rest) => JSON.stringify(rest.at(-1)))]; }
function duplicates(text) { return [show(/(?<n>a)|(?<n>b)/.exec(text)), show(/(?:(?<n>x)|(?<n>2))0/.exec(text))]; }
function unicode(text) { return [/^.$/u.test(text), /^.$/.test(text), /\u{1F600}/u.test(text), /\p{Emoji}/u.test(text), show(/./u.exec(text)), show(/./.exec(text)), text.split(/(?:)/u).length, text.split(/(?:)/).length, text.replace(/./gu, "-"), text.replace(/./g, "-")]; }
function sets(text) { return [/[\p{L}--[a-z]]/v.test(text), /[[a-z]&&[aeiou]]/v.test(text), /^\p{RGI_Emoji}$/v.test(text), show(/[\q{abc|b}]/v.exec(text))]; }
function others(text) { return [/a.c/s.test(text), /a.c/.test(text), /^c/m.test(text), /^c/.test(text), /A/i.test(text), text.match(/^\w/gm).join(), text.search(/C/i), show(/(?i:A)\n/.exec(text))]; }
function wide(text) { return [/^[a-z]+$/.test(text), /\w+/.exec(text)[0], /[^a]/.test(text), text.search(/中/), text.replace(/[一-鿿]/g, "?")]; }
console.log(indices("abc").join(" "));
console.log(named("on 2026-11-03").join(" "));
console.log(duplicates("b20").join(" "));
console.log(unicode("\u{1F600}").join(" "));
console.log(sets("aB").join(" "), sets("\u{1F600}").join(" "), sets("abc").join(" "));
console.log(others("a\nc").join(" "));
console.log(wide("abc").join(" "), wide("ab中c").join(" "));
function ropes(a, b) { const text = a + b + a; return [/ba/.test(text), /b(a)/.exec(text).index, text.match(/a+b/)[0], text.search(/ba/), text.replace(/b/, "-")]; }
console.log(ropes("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb").join(" "));
function subjects() { return [/1/.test(1), /undefined/.test(), /null/.test(null), /true/.test(true), /,/.test([1, 2]), /object/.test({}), /^x$/.test({ toString: () => "x" }), /2/.exec(123).index, /a/.exec({ toString() { return "ba"; } }).input]; }
console.log(subjects().join(" "));
function throwing() {
  const order = [];
  try { /a/.test({ toString() { order.push("asked"); throw new RangeError("no text"); } }); } catch (error) { order.push(error.name); }
  try { /a/.test(Symbol("s")); } catch (error) { order.push(error.name); }
  try { /a/.exec(Symbol.iterator); } catch (error) { order.push(error.name); }
  return order;
}
console.log(throwing().join(" "));
