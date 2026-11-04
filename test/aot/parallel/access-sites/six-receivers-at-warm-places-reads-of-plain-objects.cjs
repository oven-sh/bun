// A place that reads or calls under a name remembers what it found. Here: members of objects that are no instances of a class of the program. The build cannot type the receivers, each place runs 400 times, and six receivers are alive at once, so that each lies in another register.
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
  const make = i => ({ u: 1, v: i });
  check("literal .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("literal .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("literal .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("literal .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("literal .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("literal .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("literal .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("literal .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("literal .nope handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); }, "return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope);");
  check("literal .nope handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("literal .nope in-a-list", make, false, function (a, b, c, d, e, f) { return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|'); }, "return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|');");
  check("literal .nope in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`; }, "return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`;");
  check("literal .nope in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) }); }, "return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) });");
  check("literal .nope alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("literal .nope read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("literal .nope through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope); }, "return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope);");
})();
(function () {
  const make = i => ({ p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, p9: 9, p10: 10, p11: 11, p12: 12, p13: 13, v: i });
  check("literal-of-many .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("literal-of-many .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("literal-of-many .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("literal-of-many .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("literal-of-many .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("literal-of-many .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("literal-of-many .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("literal-of-many .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("literal-of-many .p13 handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); }, "return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13);");
  check("literal-of-many .p13 handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13); }, "return sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13);");
  check("literal-of-many .p13 in-a-list", make, false, function (a, b, c, d, e, f) { return [a.p13, b.p13, c.p13, d.p13, e.p13, f.p13].join('|'); }, "return [a.p13, b.p13, c.p13, d.p13, e.p13, f.p13].join('|');");
  check("literal-of-many .p13 in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.p13}|${b.p13}|${c.p13}|${d.p13}|${e.p13}|${f.p13}`; }, "return `${a.p13}|${b.p13}|${c.p13}|${d.p13}|${e.p13}|${f.p13}`;");
  check("literal-of-many .p13 in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.p13), b: String(b.p13), c: String(c.p13), d: String(d.p13), e: String(e.p13), f: String(f.p13) }); }, "return JSON.stringify({ a: String(a.p13), b: String(b.p13), c: String(c.p13), d: String(d.p13), e: String(e.p13), f: String(f.p13) });");
  check("literal-of-many .p13 alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("literal-of-many .p13 read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); return before + sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13); }, "const before = sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); return before + sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13);");
  check("literal-of-many .p13 through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.p13, bh.x.p13, ch.x.p13, dh.x.p13, eh.x.p13, fh.x.p13); }, "return sink(ah.x.p13, bh.x.p13, ch.x.p13, dh.x.p13, eh.x.p13, fh.x.p13);");
})();
(function () {
  const make = i => JSON.parse('{"u":1,"v":' + i + '}');
  check("parsed .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("parsed .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("parsed .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("parsed .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("parsed .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("parsed .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("parsed .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("parsed .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("parsed .nope handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); }, "return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope);");
  check("parsed .nope handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("parsed .nope in-a-list", make, false, function (a, b, c, d, e, f) { return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|'); }, "return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|');");
  check("parsed .nope in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`; }, "return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`;");
  check("parsed .nope in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) }); }, "return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) });");
  check("parsed .nope alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("parsed .nope read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("parsed .nope through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope); }, "return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope);");
})();
(function () {
  const make = i => JSON.parse('{' + Array.from({ length: 14 }, (_, k) => '"p' + k + '":' + k).join() + ',"v":' + i + '}');
  check("parsed-of-many .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("parsed-of-many .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("parsed-of-many .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("parsed-of-many .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("parsed-of-many .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("parsed-of-many .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("parsed-of-many .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("parsed-of-many .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("parsed-of-many .p13 handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); }, "return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13);");
  check("parsed-of-many .p13 handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13); }, "return sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13);");
  check("parsed-of-many .p13 in-a-list", make, false, function (a, b, c, d, e, f) { return [a.p13, b.p13, c.p13, d.p13, e.p13, f.p13].join('|'); }, "return [a.p13, b.p13, c.p13, d.p13, e.p13, f.p13].join('|');");
  check("parsed-of-many .p13 in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.p13}|${b.p13}|${c.p13}|${d.p13}|${e.p13}|${f.p13}`; }, "return `${a.p13}|${b.p13}|${c.p13}|${d.p13}|${e.p13}|${f.p13}`;");
  check("parsed-of-many .p13 in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.p13), b: String(b.p13), c: String(c.p13), d: String(d.p13), e: String(e.p13), f: String(f.p13) }); }, "return JSON.stringify({ a: String(a.p13), b: String(b.p13), c: String(c.p13), d: String(d.p13), e: String(e.p13), f: String(f.p13) });");
  check("parsed-of-many .p13 alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("parsed-of-many .p13 read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); return before + sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13); }, "const before = sink(a.p13, b.p13, c.p13, d.p13, e.p13, f.p13); return before + sink(f.p13, e.p13, d.p13, c.p13, b.p13, a.p13);");
  check("parsed-of-many .p13 through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.p13, bh.x.p13, ch.x.p13, dh.x.p13, eh.x.p13, fh.x.p13); }, "return sink(ah.x.p13, bh.x.p13, ch.x.p13, dh.x.p13, eh.x.p13, fh.x.p13);");
})();
(function () {
  const born = new Function('i', 'return { u: 1, v: i }');
  const make = i => born(i);
  check("made-by-evaluated-text .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("made-by-evaluated-text .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("made-by-evaluated-text .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("made-by-evaluated-text .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("made-by-evaluated-text .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("made-by-evaluated-text .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("made-by-evaluated-text .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("made-by-evaluated-text .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  const make = i => Object.assign(Object.create(null), { v: i });
  check("without-a-prototype .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("without-a-prototype .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("without-a-prototype .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("without-a-prototype .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("without-a-prototype .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("without-a-prototype .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("without-a-prototype .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("without-a-prototype .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("without-a-prototype .nope handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); }, "return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope);");
  check("without-a-prototype .nope handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "return sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("without-a-prototype .nope in-a-list", make, false, function (a, b, c, d, e, f) { return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|'); }, "return [a.nope, b.nope, c.nope, d.nope, e.nope, f.nope].join('|');");
  check("without-a-prototype .nope in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`; }, "return `${a.nope}|${b.nope}|${c.nope}|${d.nope}|${e.nope}|${f.nope}`;");
  check("without-a-prototype .nope in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) }); }, "return JSON.stringify({ a: String(a.nope), b: String(b.nope), c: String(c.nope), d: String(d.nope), e: String(e.nope), f: String(f.nope) });");
  check("without-a-prototype .nope alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("without-a-prototype .nope read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope); }, "const before = sink(a.nope, b.nope, c.nope, d.nope, e.nope, f.nope); return before + sink(f.nope, e.nope, d.nope, c.nope, b.nope, a.nope);");
  check("without-a-prototype .nope through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope); }, "return sink(ah.x.nope, bh.x.nope, ch.x.nope, dh.x.nope, eh.x.nope, fh.x.nope);");
})();
(function () {
  const make = i => Object.freeze({ v: i });
  check("frozen .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("frozen .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("frozen .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("frozen .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("frozen .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("frozen .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("frozen .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("frozen .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  const make = i => new Proxy({ v: i }, {});
  check("proxy .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("proxy .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("proxy .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("proxy .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("proxy .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("proxy .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("proxy .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("proxy .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  const born = new Function('i', 'return { u: i, get v() { return this.u + 1; } }');
  const make = i => born(i);
  check("own-getter .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("own-getter .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("own-getter .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("own-getter .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("own-getter .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("own-getter .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("own-getter .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("own-getter .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  const born = new Function('i', 'const o = { u: i }; for (let k = 0; k < 12; k++) o["n" + k] = k; Object.defineProperty(o, "v", { get() { return this.u + 1; }, configurable: true, enumerable: true }); return o');
  const make = i => born(i);
  check("own-getter-among-many .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("own-getter-among-many .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("own-getter-among-many .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("own-getter-among-many .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("own-getter-among-many .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("own-getter-among-many .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("own-getter-among-many .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("own-getter-among-many .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  const make = i => ({ u: i, get v() { return this.u + 1; } });
  check("own-getter-of-the-program .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("own-getter-of-the-program .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("own-getter-of-the-program .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("own-getter-of-the-program .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("own-getter-of-the-program .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("own-getter-of-the-program .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("own-getter-of-the-program .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("own-getter-of-the-program .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
(function () {
  const above = new Function('const o = {}; for (let k = 0; k < 12; k++) o["n" + k] = k; o.v = "up"; return o')();
  const make = i => Object.assign(Object.create(above), { u: i });
  check("value-in-the-storage-of-what-is-above .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("value-in-the-storage-of-what-is-above .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("value-in-the-storage-of-what-is-above .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("value-in-the-storage-of-what-is-above .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("value-in-the-storage-of-what-is-above .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("value-in-the-storage-of-what-is-above .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("value-in-the-storage-of-what-is-above .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("value-in-the-storage-of-what-is-above .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
  check("value-in-the-storage-of-what-is-above .n3 handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); }, "return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3);");
  check("value-in-the-storage-of-what-is-above .n3 handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3); }, "return sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3);");
  check("value-in-the-storage-of-what-is-above .n3 in-a-list", make, false, function (a, b, c, d, e, f) { return [a.n3, b.n3, c.n3, d.n3, e.n3, f.n3].join('|'); }, "return [a.n3, b.n3, c.n3, d.n3, e.n3, f.n3].join('|');");
  check("value-in-the-storage-of-what-is-above .n3 in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.n3}|${b.n3}|${c.n3}|${d.n3}|${e.n3}|${f.n3}`; }, "return `${a.n3}|${b.n3}|${c.n3}|${d.n3}|${e.n3}|${f.n3}`;");
  check("value-in-the-storage-of-what-is-above .n3 in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.n3), b: String(b.n3), c: String(c.n3), d: String(d.n3), e: String(e.n3), f: String(f.n3) }); }, "return JSON.stringify({ a: String(a.n3), b: String(b.n3), c: String(c.n3), d: String(d.n3), e: String(e.n3), f: String(f.n3) });");
  check("value-in-the-storage-of-what-is-above .n3 alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("value-in-the-storage-of-what-is-above .n3 read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); return before + sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3); }, "const before = sink(a.n3, b.n3, c.n3, d.n3, e.n3, f.n3); return before + sink(f.n3, e.n3, d.n3, c.n3, b.n3, a.n3);");
  check("value-in-the-storage-of-what-is-above .n3 through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.n3, bh.x.n3, ch.x.n3, dh.x.n3, eh.x.n3, fh.x.n3); }, "return sink(ah.x.n3, bh.x.n3, ch.x.n3, dh.x.n3, eh.x.n3, fh.x.n3);");
})();
(function () {
  const above = new Function('const o = {}; for (let k = 0; k < 12; k++) o["n" + k] = k; Object.defineProperty(o, "v", { get() { return this.u + 1; } }); return o')();
  const make = i => Object.assign(Object.create(above), { u: i });
  check("getter-in-the-storage-of-what-is-above .v handed-to-a-function-nobody-knows", make, false, function (a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
  check("getter-in-the-storage-of-what-is-above .v handed-on-backwards", make, false, function (a, b, c, d, e, f) { return sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "return sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("getter-in-the-storage-of-what-is-above .v in-a-list", make, false, function (a, b, c, d, e, f) { return [a.v, b.v, c.v, d.v, e.v, f.v].join('|'); }, "return [a.v, b.v, c.v, d.v, e.v, f.v].join('|');");
  check("getter-in-the-storage-of-what-is-above .v in-a-template", make, false, function (a, b, c, d, e, f) { return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`; }, "return `${a.v}|${b.v}|${c.v}|${d.v}|${e.v}|${f.v}`;");
  check("getter-in-the-storage-of-what-is-above .v in-an-object", make, false, function (a, b, c, d, e, f) { return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) }); }, "return JSON.stringify({ a: String(a.v), b: String(b.v), c: String(c.v), d: String(d.v), e: String(e.v), f: String(f.v) });");
  check("getter-in-the-storage-of-what-is-above .v alive-in-a-catch", make, false, function (a, b, c, d, e, f) { try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); } }, "try { return sink(a.v, b.v, c.v, d.v, e.v, f.v); } catch (error) { return sink(a, b, c, d, e, f, error); }");
  check("getter-in-the-storage-of-what-is-above .v read-twice-around-a-call", make, false, function (a, b, c, d, e, f) { const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v); }, "const before = sink(a.v, b.v, c.v, d.v, e.v, f.v); return before + sink(f.v, e.v, d.v, c.v, b.v, a.v);");
  check("getter-in-the-storage-of-what-is-above .v through-a-holder", make, true, function (ah, bh, ch, dh, eh, fh) { return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v); }, "return sink(ah.x.v, bh.x.v, ch.x.v, dh.x.v, eh.x.v, fh.x.v);");
})();
console.log(cases, "cases,", wrongCases, "wrong");
