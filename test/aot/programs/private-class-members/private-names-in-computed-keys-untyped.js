// Every kind of expression with a private name (read, store, call, `in`) inside a computed member key (the same program without type annotations).
function said(f) { try { const v = f(); return typeof v === "function" ? "F" : String(v); } catch (e) { return "threw " + (e).name; } }
const lines = [];
const o = JSON.parse("{}");
const fn = Object.assign(() => 7, { toString() { return "fn"; } });
let later = [];
let keys = 0;
function both(label, f) { lines.push(label + ", ahead: " + said(() => f(o))); later.push([label, f]); return "k" + ++keys; }
function afterwards(where, C) { for (const [label, f] of later) lines.push(where + " " + label + ", behind, of the class: " + said(() => f(C)) + "; of another: " + said(() => f(o))); later = []; }
class Top {
  static #f = fn;
  [both("top read", (x) => x.#f)]() {}
  [both("top typeof", (x) => typeof x.#f)]() {}
  [both("top call", (x) => x.#f())]() {}
  [both("top in", (x) => #f in x)]() {}
  [both("top compared", (x) => x.#f === x.#f)]() {}
  [both("top a template tag", (x) => x.#f`t`)]() {}
  [both("top called in parentheses", (x) => (x.#f)())]() {}
  [both("top an optional call", (x) => x.#f?.())]() {}
  [both("top in an array", (x) => [x.#f].length)]() {}
  [both("top an argument", (x) => String(x.#f))]() {}
  [both("top spread", (x) => [...[x.#f]].length)]() {}
  [both("top a condition", (x) => x.#f ? 1 : 2)]() {}
  [both("top negated", (x) => !x.#f)]() {}
  [both("top store", (x) => x.#f = fn)]() {}
  [both("top add", (x) => x.#f += 1)]() {}
  [both("top increment", (x) => x.#f++)]() {}
  [both("top decrement ahead", (x) => --x.#f)]() {}
  [both("top or", (x) => x.#f ||= fn)]() {}
  [both("top and", (x) => x.#f &&= fn)]() {}
  [both("top nullish", (x) => x.#f ??= fn)]() {}
  [both("top an array pattern", (x) => ([x.#f] = [fn]).length)]() {}
  [both("top an object pattern", (x) => ({ a: x.#f } = { a: fn }).a === fn)]() {}
  [both("top a pattern with a default", (x) => ([x.#f = fn] = []).length)]() {}
  [both("top a rest element", (x) => ([...x.#f] = [1]).length)]() {}
  [both("top a for-of head", (x) => { for (x.#f of [fn]); return "done"; })]() {}
  [both("top a for-in head", (x) => { for (x.#f in { a: 1 }); x.#f = fn; return "done"; })]() {}
  [both("top an optional chain", (x) => x?.#f)]() {}
  [both("top an optional chain, called", (x) => x?.#f?.())]() {}
  [both("top an optional chain in parentheses", (x) => (x?.#f)())]() {}
}
afterwards("top", Top);
function make() { return class Made {
  static #f = fn;
  [both("made read", (x) => x.#f)]() {}
  [both("made typeof", (x) => typeof x.#f)]() {}
  [both("made call", (x) => x.#f())]() {}
  [both("made in", (x) => #f in x)]() {}
  [both("made compared", (x) => x.#f === x.#f)]() {}
  [both("made a template tag", (x) => x.#f`t`)]() {}
  [both("made called in parentheses", (x) => (x.#f)())]() {}
  [both("made an optional call", (x) => x.#f?.())]() {}
  [both("made in an array", (x) => [x.#f].length)]() {}
  [both("made an argument", (x) => String(x.#f))]() {}
  [both("made spread", (x) => [...[x.#f]].length)]() {}
  [both("made a condition", (x) => x.#f ? 1 : 2)]() {}
  [both("made negated", (x) => !x.#f)]() {}
  [both("made store", (x) => x.#f = fn)]() {}
  [both("made add", (x) => x.#f += 1)]() {}
  [both("made increment", (x) => x.#f++)]() {}
  [both("made decrement ahead", (x) => --x.#f)]() {}
  [both("made or", (x) => x.#f ||= fn)]() {}
  [both("made and", (x) => x.#f &&= fn)]() {}
  [both("made nullish", (x) => x.#f ??= fn)]() {}
  [both("made an array pattern", (x) => ([x.#f] = [fn]).length)]() {}
  [both("made an object pattern", (x) => ({ a: x.#f } = { a: fn }).a === fn)]() {}
  [both("made a pattern with a default", (x) => ([x.#f = fn] = []).length)]() {}
  [both("made a rest element", (x) => ([...x.#f] = [1]).length)]() {}
  [both("made a for-of head", (x) => { for (x.#f of [fn]); return "done"; })]() {}
  [both("made a for-in head", (x) => { for (x.#f in { a: 1 }); x.#f = fn; return "done"; })]() {}
  [both("made an optional chain", (x) => x?.#f)]() {}
  [both("made an optional chain, called", (x) => x?.#f?.())]() {}
  [both("made an optional chain in parentheses", (x) => (x?.#f)())]() {}
}; }
afterwards("made", make());
afterwards("made again", make());
class Behind {
  [both("name behind read", (x) => x.#f)]() {}
  [both("name behind typeof", (x) => typeof x.#f)]() {}
  [both("name behind call", (x) => x.#f())]() {}
  [both("name behind in", (x) => #f in x)]() {}
  [both("name behind compared", (x) => x.#f === x.#f)]() {}
  [both("name behind a template tag", (x) => x.#f`t`)]() {}
  [both("name behind called in parentheses", (x) => (x.#f)())]() {}
  [both("name behind an optional call", (x) => x.#f?.())]() {}
  [both("name behind in an array", (x) => [x.#f].length)]() {}
  [both("name behind an argument", (x) => String(x.#f))]() {}
  [both("name behind spread", (x) => [...[x.#f]].length)]() {}
  [both("name behind a condition", (x) => x.#f ? 1 : 2)]() {}
  [both("name behind negated", (x) => !x.#f)]() {}
  [both("name behind store", (x) => x.#f = fn)]() {}
  [both("name behind add", (x) => x.#f += 1)]() {}
  [both("name behind increment", (x) => x.#f++)]() {}
  [both("name behind decrement ahead", (x) => --x.#f)]() {}
  [both("name behind or", (x) => x.#f ||= fn)]() {}
  [both("name behind and", (x) => x.#f &&= fn)]() {}
  [both("name behind nullish", (x) => x.#f ??= fn)]() {}
  [both("name behind an array pattern", (x) => ([x.#f] = [fn]).length)]() {}
  [both("name behind an object pattern", (x) => ({ a: x.#f } = { a: fn }).a === fn)]() {}
  [both("name behind a pattern with a default", (x) => ([x.#f = fn] = []).length)]() {}
  [both("name behind a rest element", (x) => ([...x.#f] = [1]).length)]() {}
  [both("name behind a for-of head", (x) => { for (x.#f of [fn]); return "done"; })]() {}
  [both("name behind a for-in head", (x) => { for (x.#f in { a: 1 }); x.#f = fn; return "done"; })]() {}
  [both("name behind an optional chain", (x) => x?.#f)]() {}
  [both("name behind an optional chain, called", (x) => x?.#f?.())]() {}
  [both("name behind an optional chain in parentheses", (x) => (x?.#f)())]() {}
  static #f = fn;
}
afterwards("name behind", Behind);
for (const line of lines) console.log(line);
