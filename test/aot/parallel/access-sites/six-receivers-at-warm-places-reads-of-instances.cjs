// A place that reads or calls under a name remembers what it found. Here: fields, accessors and what lies above instances of the program's classes. The build cannot type the receivers, each place runs 400 times, and six receivers are alive at once, so that each lies in another register.
// Each function is held against its own text evaluated at run time, which none of the compiled program's stubs run.
const launder = new Function("x", "return x");
const sink = new Function("...list", "return list.map(String).join('|')");
let cases = 0, wrongCases = 0;
function check(name, make, holds, use, text) {
  const evaluated = new Function("sink", ...(holds ? ["ah", "bh", "ch", "dh", "eh", "fh"] : ["a", "b", "c", "d", "e", "f"]), text);
  let wrong = 0, first = "";
  for (let round = 0; round < 400; round++) {
    const list = [0, 1, 2, 3, 4, 5].map(k => (holds ? launder({ x: launder(make(round + k)) }) : launder(make(round + k))));
    let got, want;
    try { got = String(use(...list)); } catch (error) { got = "threw " + error + list.length; }
    try { want = String(evaluated(sink, ...list)); } catch (error) { want = "threw " + error + list.length; }
    if (got !== want && !wrong++) first = "round " + round + ": " + got + " | " + want;
  }
  cases++;
  if (wrong) { wrongCases++; console.log(name, "wrong", wrong, first); }
}
(function () {
  class A { constructor(i) { this.v = i; } }
  const make = i => new A(i);
  check("instance-integer .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-integer .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-integer .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-integer .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-integer .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-integer .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-integer .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-integer .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("instance-integer .nope handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); }, "return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope);");
  check("instance-integer .nope handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("instance-integer .nope in-a-list", make, false, function (a, b, c, d, e, f) { return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|'); }, "return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|');");
  check("instance-integer .nope in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`; }, "return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`;");
  check("instance-integer .nope in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) }); }, "return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) });");
  check("instance-integer .nope alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-integer .nope read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("instance-integer .nope through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope); }, "return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope);");
})();
(function () {
  class A { constructor(i) { this.v = i + 0.5; } }
  const make = i => new A(i);
  check("instance-double .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-double .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-double .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-double .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-double .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-double .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-double .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-double .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.v = 't' + i; } }
  const make = i => new A(i);
  check("instance-text .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-text .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-text .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-text .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-text .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-text .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-text .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-text .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.v = i % 2 === 0; } }
  const make = i => new A(i);
  check("instance-boolean .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-boolean .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-boolean .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-boolean .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-boolean .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-boolean .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-boolean .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-boolean .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.v = i % 3 ? i : undefined; } }
  const make = i => new A(i);
  check("instance-integer-or-undefined .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-integer-or-undefined .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-integer-or-undefined .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-integer-or-undefined .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-integer-or-undefined .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-integer-or-undefined .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-integer-or-undefined .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-integer-or-undefined .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.v = i % 3 ? i + 0.25 : null; } }
  const make = i => new A(i);
  check("instance-double-or-null .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-double-or-null .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-double-or-null .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-double-or-null .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-double-or-null .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-double-or-null .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-double-or-null .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-double-or-null .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.v = i % 3 ? i % 2 === 0 : undefined; } }
  const make = i => new A(i);
  check("instance-boolean-or-undefined .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-boolean-or-undefined .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-boolean-or-undefined .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-boolean-or-undefined .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-boolean-or-undefined .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-boolean-or-undefined .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-boolean-or-undefined .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-boolean-or-undefined .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.v = i % 3 ? this : null; } toString() { return 'A'; } }
  const make = i => new A(i);
  check("instance-object-or-null .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-object-or-null .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-object-or-null .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-object-or-null .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-object-or-null .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-object-or-null .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-object-or-null .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-object-or-null .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.v = [i, 't' + i, i + 0.5, null, undefined, true][i % 6]; } }
  const make = i => new A(i);
  check("instance-any .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-any .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-any .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-any .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-any .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-any .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-any .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-any .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.u = i; if (i % 2) this.v = i; } }
  const make = i => new A(i);
  check("instance-field-left-out .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-field-left-out .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-field-left-out .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-field-left-out .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-field-left-out .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-field-left-out .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-field-left-out .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-field-left-out .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("instance-field-left-out .u handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.u, b.u, c.u, d.u, e.u, f.u); }, "return sink(a.u, b.u, c.u, d.u, e.u, f.u);");
  check("instance-field-left-out .u handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.u, e.u, d.u, c.u, b.u, a.u); }, "return sink(f.u, e.u, d.u, c.u, b.u, a.u);");
  check("instance-field-left-out .u in-a-list", make, false, function (a, b, c, d, e, f) { return [a.u, b.u, c.u, d.u, e.u, f.u].join('|'); }, "return [a.u, b.u, c.u, d.u, e.u, f.u].join('|');");
  check("instance-field-left-out .u in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.u}|${b.u}|${c.u}|${d.u}|${e.u}|${f.u}`; }, "return `${a.u}|${b.u}|${c.u}|${d.u}|${e.u}|${f.u}`;");
  check("instance-field-left-out .u in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.u), b: String(b.u), c: String(c.u), d: String(d.u), e: String(e.u), f: String(f.u) }); }, "return JSON.stringify({ a: String(a.u), b: String(b.u), c: String(c.u), d: String(d.u), e: String(e.u), f: String(f.u) });");
  check("instance-field-left-out .u alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.u, b.u, c.u, d.u, e.u, f.u); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.u, b.u, c.u, d.u, e.u, f.u); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-field-left-out .u read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.u, b.u, c.u, d.u, e.u, f.u); return before + sink(f.u, e.u, d.u, c.u, b.u, a.u); }, "const before = sink(a.u, b.u, c.u, d.u, e.u, f.u); return before + sink(f.u, e.u, d.u, c.u, b.u, a.u);");
  check("instance-field-left-out .u through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.u, bh.x.u, ch.x.u, dh.x.u, eh.x.u, fh.x.u); }, "return sink(ah.x.u, bh.x.u, ch.x.u, dh.x.u, eh.x.u, fh.x.u);");
})();
(function () {
  class A { constructor(i) { this.v = i; } }
  class B { constructor(i) { this.u = 't'; this.v = i + 1; } }
  const make = i => i % 2 ? new A(i) : new B(i);
  check("instances-of-two-classes .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instances-of-two-classes .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instances-of-two-classes .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instances-of-two-classes .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instances-of-two-classes .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instances-of-two-classes .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instances-of-two-classes .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instances-of-two-classes .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class C0 { constructor(i) { this.v = i + 0; } }
  class C1 { constructor(i) { this.p0 = 0; this.v = i + 1; } }
  class C2 { constructor(i) { this.p0 = 0; this.p1 = 1; this.v = i + 2; } }
  class C3 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.v = i + 3; } }
  class C4 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.v = i + 4; } }
  const classes = [C0, C1, C2, C3, C4];
  const make = i => new classes[i % 5](i);
  check("instances-of-five-classes .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instances-of-five-classes .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instances-of-five-classes .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instances-of-five-classes .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instances-of-five-classes .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instances-of-five-classes .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instances-of-five-classes .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instances-of-five-classes .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.w = i; } get v() { return this.w + 1; } }
  const make = i => new A(i);
  check("instance-getter .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-getter .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-getter .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-getter .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-getter .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-getter .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-getter .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-getter .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.w = i; } v() {} }
  const make = i => new A(i);
  check("instance-method .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-method .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-method .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-method .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-method .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-method .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-method .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-method .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.w = i; } }
  A.prototype.v = 7;
  const make = i => new A(i);
  check("instance-value-above .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-value-above .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-value-above .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-value-above .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-value-above .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-value-above .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-value-above .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-value-above .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class Z { }
  Z.prototype.v = 'z';
  class A extends Z { constructor(i) { super(); this.w = i; } }
  const make = i => new A(i);
  check("instance-value-two-above .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-value-two-above .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-value-two-above .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-value-two-above .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-value-two-above .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-value-two-above .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-value-two-above .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-value-two-above .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  class A { constructor(i) { this.w = i; } }
  const lay = new Function('o', 'i', 'o.v = i * 2; return o');
  const make = i => lay(new A(i), i);
  check("instance-with-a-name-laid-on .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-with-a-name-laid-on .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-with-a-name-laid-on .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-with-a-name-laid-on .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-with-a-name-laid-on .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-with-a-name-laid-on .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-with-a-name-laid-on .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-with-a-name-laid-on .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("instance-with-a-name-laid-on .w handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.w, b.w, c.w, d.w, e.w, f.w); }, "return sink(a.w, b.w, c.w, d.w, e.w, f.w);");
  check("instance-with-a-name-laid-on .w handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.w, e.w, d.w, c.w, b.w, a.w); }, "return sink(f.w, e.w, d.w, c.w, b.w, a.w);");
  check("instance-with-a-name-laid-on .w in-a-list", make, false, function (a, b, c, d, e, f) { return [a.w, b.w, c.w, d.w, e.w, f.w].join('|'); }, "return [a.w, b.w, c.w, d.w, e.w, f.w].join('|');");
  check("instance-with-a-name-laid-on .w in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.w}|${b.w}|${c.w}|${d.w}|${e.w}|${f.w}`; }, "return `${a.w}|${b.w}|${c.w}|${d.w}|${e.w}|${f.w}`;");
  check("instance-with-a-name-laid-on .w in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.w), b: String(b.w), c: String(c.w), d: String(d.w), e: String(e.w), f: String(f.w) }); }, "return JSON.stringify({ a: String(a.w), b: String(b.w), c: String(c.w), d: String(d.w), e: String(e.w), f: String(f.w) });");
  check("instance-with-a-name-laid-on .w alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.w, b.w, c.w, d.w, e.w, f.w); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.w, b.w, c.w, d.w, e.w, f.w); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-with-a-name-laid-on .w read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.w, b.w, c.w, d.w, e.w, f.w); return before + sink(f.w, e.w, d.w, c.w, b.w, a.w); }, "const before = sink(a.w, b.w, c.w, d.w, e.w, f.w); return before + sink(f.w, e.w, d.w, c.w, b.w, a.w);");
  check("instance-with-a-name-laid-on .w through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.w, bh.x.w, ch.x.w, dh.x.w, eh.x.w, fh.x.w); }, "return sink(ah.x.w, bh.x.w, ch.x.w, dh.x.w, eh.x.w, fh.x.w);");
})();
(function () {
  class A { constructor(i) { this.w = i; } }
  const lay = new Function('o', 'i', 'for (let k = 0; k < 12; k++) o["n" + k] = k; o.v = i * 2; return o');
  const make = i => lay(new A(i), i);
  check("instance-with-many-names-laid-on .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-with-many-names-laid-on .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-with-many-names-laid-on .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-with-many-names-laid-on .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-with-many-names-laid-on .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-with-many-names-laid-on .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-with-many-names-laid-on .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-with-many-names-laid-on .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("instance-with-many-names-laid-on .n11 handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.n11, b.n11, c.n11, d.n11, e.n11, f.n11); }, "return sink(a.n11, b.n11, c.n11, d.n11, e.n11, f.n11);");
  check("instance-with-many-names-laid-on .n11 handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.n11, e.n11, d.n11, c.n11, b.n11, a.n11); }, "return sink(f.n11, e.n11, d.n11, c.n11, b.n11, a.n11);");
  check("instance-with-many-names-laid-on .n11 in-a-list", make, false, function (a, b, c, d, e, f) { return [a.n11, b.n11, c.n11, d.n11, e.n11, f.n11].join('|'); }, "return [a.n11, b.n11, c.n11, d.n11, e.n11, f.n11].join('|');");
  check("instance-with-many-names-laid-on .n11 in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.n11}|${b.n11}|${c.n11}|${d.n11}|${e.n11}|${f.n11}`; }, "return `${a.n11}|${b.n11}|${c.n11}|${d.n11}|${e.n11}|${f.n11}`;");
  check("instance-with-many-names-laid-on .n11 in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.n11), b: String(b.n11), c: String(c.n11), d: String(d.n11), e: String(e.n11), f: String(f.n11) }); }, "return JSON.stringify({ a: String(a.n11), b: String(b.n11), c: String(c.n11), d: String(d.n11), e: String(e.n11), f: String(f.n11) });");
  check("instance-with-many-names-laid-on .n11 alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.n11, b.n11, c.n11, d.n11, e.n11, f.n11); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.n11, b.n11, c.n11, d.n11, e.n11, f.n11); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-with-many-names-laid-on .n11 read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.n11, b.n11, c.n11, d.n11, e.n11, f.n11); return before + sink(f.n11, e.n11, d.n11, c.n11, b.n11, a.n11); }, "const before = sink(a.n11, b.n11, c.n11, d.n11, e.n11, f.n11); return before + sink(f.n11, e.n11, d.n11, c.n11, b.n11, a.n11);");
  check("instance-with-many-names-laid-on .n11 through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.n11, bh.x.n11, ch.x.n11, dh.x.n11, eh.x.n11, fh.x.n11); }, "return sink(ah.x.n11, bh.x.n11, ch.x.n11, dh.x.n11, eh.x.n11, fh.x.n11);");
})();
(function () {
  const above = new Function('const o = {}; for (let k = 0; k < 12; k++) o["n" + k] = k; o.v = "up"; return o')();
  class A { constructor(i) { this.w = i; } }
  Object.setPrototypeOf(A.prototype, above);
  const make = i => new A(i);
  check("instance-above-which-a-plain-object-lies .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("instance-above-which-a-plain-object-lies .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-above-which-a-plain-object-lies .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("instance-above-which-a-plain-object-lies .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("instance-above-which-a-plain-object-lies .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("instance-above-which-a-plain-object-lies .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-above-which-a-plain-object-lies .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("instance-above-which-a-plain-object-lies .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("instance-above-which-a-plain-object-lies .n3 handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); }, "return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3);");
  check("instance-above-which-a-plain-object-lies .n3 handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3); }, "return sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3);");
  check("instance-above-which-a-plain-object-lies .n3 in-a-list", make, false, function (a, b, c, d, e, f) { return [a.n3, b.n3, c.n3, d.n3, e.n3, f.n3].join('|'); }, "return [a.n3, b.n3, c.n3, d.n3, e.n3, f.n3].join('|');");
  check("instance-above-which-a-plain-object-lies .n3 in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.n3}|${b.n3}|${c.n3}|${d.n3}|${e.n3}|${f.n3}`; }, "return `${a.n3}|${b.n3}|${c.n3}|${d.n3}|${e.n3}|${f.n3}`;");
  check("instance-above-which-a-plain-object-lies .n3 in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.n3), b: String(b.n3), c: String(c.n3), d: String(d.n3), e: String(e.n3), f: String(f.n3) }); }, "return JSON.stringify({ a: String(a.n3), b: String(b.n3), c: String(c.n3), d: String(d.n3), e: String(e.n3), f: String(f.n3) });");
  check("instance-above-which-a-plain-object-lies .n3 alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-above-which-a-plain-object-lies .n3 read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); return before + sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3); }, "const before = sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); return before + sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3);");
  check("instance-above-which-a-plain-object-lies .n3 through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.n3, bh.x.n3, ch.x.n3, dh.x.n3, eh.x.n3, fh.x.n3); }, "return sink(ah.x.n3, bh.x.n3, ch.x.n3, dh.x.n3, eh.x.n3, fh.x.n3);");
  check("instance-above-which-a-plain-object-lies .w handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.w, b.w, c.w, d.w, e.w, f.w); }, "return sink(a.w, b.w, c.w, d.w, e.w, f.w);");
  check("instance-above-which-a-plain-object-lies .w handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.w, e.w, d.w, c.w, b.w, a.w); }, "return sink(f.w, e.w, d.w, c.w, b.w, a.w);");
  check("instance-above-which-a-plain-object-lies .w in-a-list", make, false, function (a, b, c, d, e, f) { return [a.w, b.w, c.w, d.w, e.w, f.w].join('|'); }, "return [a.w, b.w, c.w, d.w, e.w, f.w].join('|');");
  check("instance-above-which-a-plain-object-lies .w in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.w}|${b.w}|${c.w}|${d.w}|${e.w}|${f.w}`; }, "return `${a.w}|${b.w}|${c.w}|${d.w}|${e.w}|${f.w}`;");
  check("instance-above-which-a-plain-object-lies .w in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.w), b: String(b.w), c: String(c.w), d: String(d.w), e: String(e.w), f: String(f.w) }); }, "return JSON.stringify({ a: String(a.w), b: String(b.w), c: String(c.w), d: String(d.w), e: String(e.w), f: String(f.w) });");
  check("instance-above-which-a-plain-object-lies .w alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.w, b.w, c.w, d.w, e.w, f.w); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.w, b.w, c.w, d.w, e.w, f.w); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("instance-above-which-a-plain-object-lies .w read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.w, b.w, c.w, d.w, e.w, f.w); return before + sink(f.w, e.w, d.w, c.w, b.w, a.w); }, "const before = sink(a.w, b.w, c.w, d.w, e.w, f.w); return before + sink(f.w, e.w, d.w, c.w, b.w, a.w);");
  check("instance-above-which-a-plain-object-lies .w through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.w, bh.x.w, ch.x.w, dh.x.w, eh.x.w, fh.x.w); }, "return sink(ah.x.w, bh.x.w, ch.x.w, dh.x.w, eh.x.w, fh.x.w);");
})();
console.log(cases, "cases,", wrongCases, "wrong");
