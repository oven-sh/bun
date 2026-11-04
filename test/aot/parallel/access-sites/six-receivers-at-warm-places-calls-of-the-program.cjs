// A place that reads or calls under a name remembers what it found. Here: methods and functions of the program. The build cannot type the receivers, each place runs 400 times, and six receivers are alive at once, so that each lies in another register.
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
  class A { constructor(i) { this.w = i; } m() { return this.w + 1; } }
  const make = i => new A(i);
  check("call-method .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-method .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-method .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-method .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-method .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-method .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-method .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-method .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class A { constructor(i) { this.w = i; } m(x, y) { return this.w + x * y; } }
  const make = i => new A(i);
  check("call-method-with-operands .m(2, 3) handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3)); }, "return sink(a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3));");
  check("call-method-with-operands .m(2, 3) handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(2, 3), e.m(2, 3), d.m(2, 3), c.m(2, 3), b.m(2, 3), a.m(2, 3)); }, "return sink(f.m(2, 3), e.m(2, 3), d.m(2, 3), c.m(2, 3), b.m(2, 3), a.m(2, 3));");
  check("call-method-with-operands .m(2, 3) in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3)].join('|'); }, "return [a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3)].join('|');");
  check("call-method-with-operands .m(2, 3) in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m(2, 3)}|${b.m(2, 3)}|${c.m(2, 3)}|${d.m(2, 3)}|${e.m(2, 3)}|${f.m(2, 3)}`; }, "return `${a.m(2, 3)}|${b.m(2, 3)}|${c.m(2, 3)}|${d.m(2, 3)}|${e.m(2, 3)}|${f.m(2, 3)}`;");
  check("call-method-with-operands .m(2, 3) in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m(2, 3)), b: String(b.m(2, 3)), c: String(c.m(2, 3)), d: String(d.m(2, 3)), e: String(e.m(2, 3)), f: String(f.m(2, 3)) }); }, "return JSON.stringify({ a: String(a.m(2, 3)), b: String(b.m(2, 3)), c: String(c.m(2, 3)), d: String(d.m(2, 3)), e: String(e.m(2, 3)), f: String(f.m(2, 3)) });");
  check("call-method-with-operands .m(2, 3) alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3)); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3)); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-method-with-operands .m(2, 3) read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3)); return before + sink(f.m(2, 3), e.m(2, 3), d.m(2, 3), c.m(2, 3), b.m(2, 3), a.m(2, 3)); }, "const before = sink(a.m(2, 3), b.m(2, 3), c.m(2, 3), d.m(2, 3), e.m(2, 3), f.m(2, 3)); return before + sink(f.m(2, 3), e.m(2, 3), d.m(2, 3), c.m(2, 3), b.m(2, 3), a.m(2, 3));");
  check("call-method-with-operands .m(2, 3) through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(2, 3), bh.x.m(2, 3), ch.x.m(2, 3), dh.x.m(2, 3), eh.x.m(2, 3), fh.x.m(2, 3)); }, "return sink(ah.x.m(2, 3), bh.x.m(2, 3), ch.x.m(2, 3), dh.x.m(2, 3), eh.x.m(2, 3), fh.x.m(2, 3));");
  check("call-method-with-operands .m(2) handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2)); }, "return sink(a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2));");
  check("call-method-with-operands .m(2) handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(2), e.m(2), d.m(2), c.m(2), b.m(2), a.m(2)); }, "return sink(f.m(2), e.m(2), d.m(2), c.m(2), b.m(2), a.m(2));");
  check("call-method-with-operands .m(2) in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2)].join('|'); }, "return [a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2)].join('|');");
  check("call-method-with-operands .m(2) in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m(2)}|${b.m(2)}|${c.m(2)}|${d.m(2)}|${e.m(2)}|${f.m(2)}`; }, "return `${a.m(2)}|${b.m(2)}|${c.m(2)}|${d.m(2)}|${e.m(2)}|${f.m(2)}`;");
  check("call-method-with-operands .m(2) in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m(2)), b: String(b.m(2)), c: String(c.m(2)), d: String(d.m(2)), e: String(e.m(2)), f: String(f.m(2)) }); }, "return JSON.stringify({ a: String(a.m(2)), b: String(b.m(2)), c: String(c.m(2)), d: String(d.m(2)), e: String(e.m(2)), f: String(f.m(2)) });");
  check("call-method-with-operands .m(2) alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2)); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2)); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-method-with-operands .m(2) read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2)); return before + sink(f.m(2), e.m(2), d.m(2), c.m(2), b.m(2), a.m(2)); }, "const before = sink(a.m(2), b.m(2), c.m(2), d.m(2), e.m(2), f.m(2)); return before + sink(f.m(2), e.m(2), d.m(2), c.m(2), b.m(2), a.m(2));");
  check("call-method-with-operands .m(2) through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(2), bh.x.m(2), ch.x.m(2), dh.x.m(2), eh.x.m(2), fh.x.m(2)); }, "return sink(ah.x.m(2), bh.x.m(2), ch.x.m(2), dh.x.m(2), eh.x.m(2), fh.x.m(2));");
  check("call-method-with-operands .m(2, 3, 4) handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4)); }, "return sink(a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4));");
  check("call-method-with-operands .m(2, 3, 4) handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(2, 3, 4), e.m(2, 3, 4), d.m(2, 3, 4), c.m(2, 3, 4), b.m(2, 3, 4), a.m(2, 3, 4)); }, "return sink(f.m(2, 3, 4), e.m(2, 3, 4), d.m(2, 3, 4), c.m(2, 3, 4), b.m(2, 3, 4), a.m(2, 3, 4));");
  check("call-method-with-operands .m(2, 3, 4) in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4)].join('|'); }, "return [a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4)].join('|');");
  check("call-method-with-operands .m(2, 3, 4) in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m(2, 3, 4)}|${b.m(2, 3, 4)}|${c.m(2, 3, 4)}|${d.m(2, 3, 4)}|${e.m(2, 3, 4)}|${f.m(2, 3, 4)}`; }, "return `${a.m(2, 3, 4)}|${b.m(2, 3, 4)}|${c.m(2, 3, 4)}|${d.m(2, 3, 4)}|${e.m(2, 3, 4)}|${f.m(2, 3, 4)}`;");
  check("call-method-with-operands .m(2, 3, 4) in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m(2, 3, 4)), b: String(b.m(2, 3, 4)), c: String(c.m(2, 3, 4)), d: String(d.m(2, 3, 4)), e: String(e.m(2, 3, 4)), f: String(f.m(2, 3, 4)) }); }, "return JSON.stringify({ a: String(a.m(2, 3, 4)), b: String(b.m(2, 3, 4)), c: String(c.m(2, 3, 4)), d: String(d.m(2, 3, 4)), e: String(e.m(2, 3, 4)), f: String(f.m(2, 3, 4)) });");
  check("call-method-with-operands .m(2, 3, 4) alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4)); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4)); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-method-with-operands .m(2, 3, 4) read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4)); return before + sink(f.m(2, 3, 4), e.m(2, 3, 4), d.m(2, 3, 4), c.m(2, 3, 4), b.m(2, 3, 4), a.m(2, 3, 4)); }, "const before = sink(a.m(2, 3, 4), b.m(2, 3, 4), c.m(2, 3, 4), d.m(2, 3, 4), e.m(2, 3, 4), f.m(2, 3, 4)); return before + sink(f.m(2, 3, 4), e.m(2, 3, 4), d.m(2, 3, 4), c.m(2, 3, 4), b.m(2, 3, 4), a.m(2, 3, 4));");
  check("call-method-with-operands .m(2, 3, 4) through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(2, 3, 4), bh.x.m(2, 3, 4), ch.x.m(2, 3, 4), dh.x.m(2, 3, 4), eh.x.m(2, 3, 4), fh.x.m(2, 3, 4)); }, "return sink(ah.x.m(2, 3, 4), bh.x.m(2, 3, 4), ch.x.m(2, 3, 4), dh.x.m(2, 3, 4), eh.x.m(2, 3, 4), fh.x.m(2, 3, 4));");
})();
(function () {
  class Z { m() { return this.w + 2; } }
  class A extends Z { constructor(i) { super(); this.w = i; } }
  const make = i => new A(i);
  check("call-method-two-above .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-method-two-above .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-method-two-above .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-method-two-above .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-method-two-above .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-method-two-above .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-method-two-above .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-method-two-above .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class A { constructor(i) { this.w = i; } m() { return this.w + 1; } }
  class B { constructor(i) { this.u = 0; this.w = i; } m() { return this.w - 1; } }
  const make = i => i % 2 ? new A(i) : new B(i);
  check("call-methods-of-two-classes .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-methods-of-two-classes .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-methods-of-two-classes .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-methods-of-two-classes .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-methods-of-two-classes .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-methods-of-two-classes .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-methods-of-two-classes .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-methods-of-two-classes .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class C0 { constructor(i) { this.w = i; } m() { return this.w + 0; } }
  class C1 { constructor(i) { this.w = i; } m() { return this.w + 1; } }
  class C2 { constructor(i) { this.w = i; } m() { return this.w + 2; } }
  class C3 { constructor(i) { this.w = i; } m() { return this.w + 3; } }
  class C4 { constructor(i) { this.w = i; } m() { return this.w + 4; } }
  const classes = [C0, C1, C2, C3, C4];
  const make = i => new classes[i % 5](i);
  check("call-methods-of-five-classes .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-methods-of-five-classes .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-methods-of-five-classes .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-methods-of-five-classes .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-methods-of-five-classes .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-methods-of-five-classes .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-methods-of-five-classes .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-methods-of-five-classes .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class A { constructor(i) { this.m = () => i + 1; } }
  const make = i => new A(i);
  check("call-closure-in-a-field .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-closure-in-a-field .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-closure-in-a-field .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-closure-in-a-field .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-closure-in-a-field .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-closure-in-a-field .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-closure-in-a-field .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-closure-in-a-field .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  function shared() { return this.w; }
  class A { constructor(i) { this.w = i; this.m = shared; } }
  const make = i => new A(i);
  check("call-function-in-a-field .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-function-in-a-field .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-in-a-field .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-function-in-a-field .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-function-in-a-field .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-function-in-a-field .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-function-in-a-field .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-in-a-field .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  const make = i => ({ w: i, m() { return this.w + 1; } });
  check("call-function-of-a-literal .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-function-of-a-literal .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-of-a-literal .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-function-of-a-literal .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-function-of-a-literal .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-function-of-a-literal .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-function-of-a-literal .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-of-a-literal .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  const born = new Function('i', 'return { w: i, m() { return this.w + 1; } }');
  const make = i => born(i);
  check("call-function-of-evaluated-text .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-function-of-evaluated-text .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-of-evaluated-text .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-function-of-evaluated-text .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-function-of-evaluated-text .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-function-of-evaluated-text .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-function-of-evaluated-text .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-of-evaluated-text .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  const born = new Function('i', 'const o = { w: i }; for (let k = 0; k < 12; k++) o["n" + k] = k; o.m = function () { return this.w + 1; }; return o');
  const make = i => born(i);
  check("call-function-among-many .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-function-among-many .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-among-many .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-function-among-many .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-function-among-many .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-function-among-many .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-function-among-many .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-among-many .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  const above = new Function('const o = {}; for (let k = 0; k < 12; k++) o["n" + k] = k; o.m = function () { return this.w + 1; }; return o')();
  const make = i => Object.assign(Object.create(above), { w: i });
  check("call-function-above-in-storage .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-function-above-in-storage .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-above-in-storage .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-function-above-in-storage .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-function-above-in-storage .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-function-above-in-storage .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-function-above-in-storage .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-above-in-storage .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class A { constructor(i) { this.w = i; } get m() { const w = this.w; return () => w + 1; } }
  const make = i => new A(i);
  check("call-what-a-getter-answers .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-what-a-getter-answers .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-what-a-getter-answers .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-what-a-getter-answers .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-what-a-getter-answers .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-what-a-getter-answers .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-what-a-getter-answers .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-what-a-getter-answers .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class A { constructor(i) { this.w = i; } }
  const lay = new Function('o', 'o.m = function () { return this.w + 1; }; return o');
  const make = i => lay(new A(i));
  check("call-function-laid-on .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-function-laid-on .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-laid-on .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-function-laid-on .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-function-laid-on .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-function-laid-on .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-function-laid-on .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-function-laid-on .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class A { static w = 3; static m() { return this.w + 1; } }
  class B extends A { static w = 4; }
  const make = i => i % 2 ? A : B;
  check("call-static .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-static .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-static .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-static .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-static .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-static .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-static .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-static .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
(function () {
  class A { constructor(i) { this.w = i; } }
  const make = i => new A(i);
  check("call-what-is-absent .nope() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope()); }, "return sink(a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope());");
  check("call-what-is-absent .nope() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.nope(), e.nope(), d.nope(), c.nope(), b.nope(), a.nope()); }, "return sink(f.nope(), e.nope(), d.nope(), c.nope(), b.nope(), a.nope());");
  check("call-what-is-absent .nope() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope()].join('|'); }, "return [a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope()].join('|');");
  check("call-what-is-absent .nope() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.nope()}|${b.nope()}|${c.nope()}|${d.nope()}|${e.nope()}|${f.nope()}`; }, "return `${a.nope()}|${b.nope()}|${c.nope()}|${d.nope()}|${e.nope()}|${f.nope()}`;");
  check("call-what-is-absent .nope() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.nope()), b: String(b.nope()), c: String(c.nope()), d: String(d.nope()), e: String(e.nope()), f: String(f.nope()) }); }, "return JSON.stringify({ a: String(a.nope()), b: String(b.nope()), c: String(c.nope()), d: String(d.nope()), e: String(e.nope()), f: String(f.nope()) });");
  check("call-what-is-absent .nope() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-what-is-absent .nope() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope()); return before + sink(f.nope(), e.nope(), d.nope(), c.nope(), b.nope(), a.nope()); }, "const before = sink(a.nope(), b.nope(), c.nope(), d.nope(), e.nope(), f.nope()); return before + sink(f.nope(), e.nope(), d.nope(), c.nope(), b.nope(), a.nope());");
  check("call-what-is-absent .nope() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.nope(), bh.x.nope(), ch.x.nope(), dh.x.nope(), eh.x.nope(), fh.x.nope()); }, "return sink(ah.x.nope(), bh.x.nope(), ch.x.nope(), dh.x.nope(), eh.x.nope(), fh.x.nope());");
})();
(function () {
  class A { constructor(i) { this.m = i; } }
  const make = i => new A(i);
  check("call-what-is-no-function .m() handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
  check("call-what-is-no-function .m() handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "return sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-what-is-no-function .m() in-a-list", make, false, function (a, b, c, d, e, f) { return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|'); }, "return [a.m(), b.m(), c.m(), d.m(), e.m(), f.m()].join('|');");
  check("call-what-is-no-function .m() in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`; }, "return `${a.m()}|${b.m()}|${c.m()}|${d.m()}|${e.m()}|${f.m()}`;");
  check("call-what-is-no-function .m() in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) }); }, "return JSON.stringify({ a: String(a.m()), b: String(b.m()), c: String(c.m()), d: String(d.m()), e: String(e.m()), f: String(f.m()) });");
  check("call-what-is-no-function .m() alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("call-what-is-no-function .m() read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m()); }, "const before = sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); return before + sink(f.m(), e.m(), d.m(), c.m(), b.m(), a.m());");
  check("call-what-is-no-function .m() through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m()); }, "return sink(ah.x.m(), bh.x.m(), ch.x.m(), dh.x.m(), eh.x.m(), fh.x.m());");
})();
console.log(cases, "cases,", wrongCases, "wrong");
