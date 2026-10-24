// Object literals in text evaluated at run time whose objects get more properties afterwards: by the text itself, by compiled code, by Object.assign and defineProperty.
// The run time gives later objects of such a literal more room. Whatever room an object has, its keys, their order and their values are the same.
const lines = [];
const describe = object => JSON.stringify(object) + " " + Object.keys(object).join() + " " + Reflect.ownKeys(object).length;
function show(name, run, turns = 12) {
  const seen = [];
  const kept = [];
  for (let turn = 0; turn < turns; turn++) {
    const object = run(turn);
    kept.push(object);
    seen.push(describe(object));
  }
  const distinct = [...new Set(seen.map(text => text.replace(/\d+/g, "#")))];
  lines.push(name + ": " + distinct.length + " form(s): " + seen[0] + " .. " + seen[turns - 1] + " | the first again: " + describe(kept[0]) + " | the fifth: " + describe(kept[4]));
}
const make = (parameters, text) => new Function(...parameters, text);

show("eight names and one more", make(["i"], "const c = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 }; c.query = i + 1; return c;"));
show("six names and one more", make(["i"], "const c = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 }; c.body = i; return c;"));
show("two names and twelve more", make(["i"], "const c = { a: i, b: 1 }; c.p0 = 0; c.p1 = 1; c.p2 = 2; c.p3 = 3; c.p4 = 4; c.p5 = 5; c.p6 = 6; c.p7 = 7; c.p8 = 8; c.p9 = 9; c.p10 = 10; c.p11 = i; return c;"));
show("one name, more in every turn", make(["i"], "const c = { a: i }; for (let k = 0; k < i; k++) c['k' + k] = k; return c;"), 24);
show("sixteen names and three more", make(["i"], "const c = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9, k: 10, l: 11, m: 12, n: 13, o: 14, p: i }; c.q = 1; c.r = 2; c.s = i; return c;"));
show("the same literal at two places, one of which adds", (() => {
  const both = make(["i", "adds"], "const c = adds ? { a: i, b: 1, c: 2 } : { a: i, b: 1, c: 2 }; if (adds) { c.d = 1; c.e = 2; c.f = 3; c.g = 4; c.h = 5; } return c;");
  return turn => both(turn, turn % 3 !== 0);
})());
show("other names in other turns", make(["i"], "const c = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 }; if (i & 1) c.odd = i; else c.even = i; c.last = 0; return c;"));
show("compiled code adds", (() => {
  const literal = make(["i"], "return { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 };");
  return turn => { const c = literal(turn); c.added = turn; c.more = 1; c.evenMore = 2; return c; };
})());
show("Object.assign and defineProperty add", (() => {
  const literal = make(["i"], "const c = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 }; c.g = 6; return c;");
  return turn => { const c = Object.assign(literal(turn), { x: 1, y: 2 }); Object.defineProperty(c, "hidden", { value: turn, enumerable: false }); return c; };
})());
show("a property is deleted and added again", make(["i"], "const c = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 }; c.g = 6; delete c.b; c.b = i; c.h = 7; return c;"));
show("an index and a symbol are added", make(["i"], "const c = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 }; c[0] = i; c[Symbol.for('s')] = 1; c.g = 2; return c;"));
show("frozen behind the addition", make(["i"], "const c = { a: i, b: 1, c: 2, d: 3, e: 4, f: 5 }; c.g = 6; Object.freeze(c); try { c.h = 7; } catch {} return c;"));
show("a literal with the names of a compiled record gets more", (() => {
  const compiled = turn => ({ value: turn, issues: [] });
  const literal = make(["i"], "const c = { value: i, issues: [] }; c.aborted = true; c.more = i; c.evenMore = 1; return c;");
  return turn => (turn & 1 ? literal(turn) : Object.assign(compiled(turn), { aborted: true, more: turn, evenMore: 1 }));
})());
show("a nested literal gets more", make(["i"], "const c = { request: i, set: { headers: {}, status: 200 } }; c.set.cookie = i; c.set.redirect = 1; c.set.more = 2; c.set.headers.a = 1; c.query = i; return c;"));
console.log(lines.join("\n"));
