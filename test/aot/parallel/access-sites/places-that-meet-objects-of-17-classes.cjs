// Places that read, call and store under a name meet objects of 17 classes in turns, six alive at once: what the tables behind the places hold is thrown out and filed again all the time.
// 424242: what a build with stubs broken on purpose changes, and nothing else: the red control of this program.
const launder = new Function("x", "return x");
const sink = new Function("...list", "return list.map(String).join('|')");
const classes = [];
classes.push(class K0 { constructor(i) { this.v = i; this.w0 = 0; } m() { return 0 + String(this.v); } get g() { return 0; } });
classes.push(class K1 { constructor(i) { this.p0 = 0; this.v = i + 0.5; this.w1 = 1; } m() { return 1 + String(this.v); } get g() { return 1; } });
classes.push(class K2 { constructor(i) { this.p0 = 0; this.p1 = 1; this.v = 't' + i; this.w2 = 2; } m() { return 2 + String(this.v); } get g() { return 2; } });
classes.push(class K3 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.v = i % 2 === 0; this.w3 = 3; } m() { return 3 + String(this.v); } get g() { return 3; } });
classes.push(class K4 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.v = i % 3 ? i : undefined; this.w4 = 4; } m() { return 4 + String(this.v); } get g() { return 4; } });
classes.push(class K5 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.p4 = 4; this.v = null; this.w5 = 5; } m() { return 5 + String(this.v); } get g() { return 5; } });
classes.push(class K6 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.p4 = 4; this.p5 = 5; this.v = i; this.w6 = 6; } m() { return 6 + String(this.v); } get g() { return 6; } });
classes.push(class K7 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.p4 = 4; this.p5 = 5; this.p6 = 6; this.v = i + 0.5; this.w7 = 7; } m() { return 7 + String(this.v); } get g() { return 7; } });
classes.push(class K8 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.p4 = 4; this.p5 = 5; this.p6 = 6; this.p7 = 7; this.v = 't' + i; this.w8 = 8; } m() { return 8 + String(this.v); } get g() { return 8; } });
classes.push(class K9 { constructor(i) { this.v = i % 2 === 0; this.w9 = 9; } m() { return 9 + String(this.v); } get g() { return 9; } });
classes.push(class K10 { constructor(i) { this.p0 = 0; this.v = i % 3 ? i : undefined; this.w10 = 10; } m() { return 10 + String(this.v); } get g() { return 10; } });
classes.push(class K11 { constructor(i) { this.p0 = 0; this.p1 = 1; this.v = null; this.w0 = 11; } m() { return 11 + String(this.v); } get g() { return 11; } });
classes.push(class K12 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.v = i; this.w1 = 12; } m() { return 12 + String(this.v); } get g() { return 12; } });
classes.push(class K13 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.v = i + 0.5; this.w2 = 13; } m() { return 13 + String(this.v); } get g() { return 13; } });
classes.push(class K14 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.p4 = 4; this.v = 't' + i; this.w3 = 14; } m() { return 14 + String(this.v); } get g() { return 14; } });
classes.push(class K15 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.p4 = 4; this.p5 = 5; this.v = i % 2 === 0; this.w4 = 15; } m() { return 15 + String(this.v); } get g() { return 15; } });
classes.push(class K16 { constructor(i) { this.p0 = 0; this.p1 = 1; this.p2 = 2; this.p3 = 3; this.p4 = 4; this.p5 = 5; this.p6 = 6; this.v = i % 3 ? i : undefined; this.w5 = 16; } m() { return 16 + String(this.v); } get g() { return 16; } });
let cases = 0, wrongCases = 0;
function check(name, use, text) {
  const evaluated = new Function("sink", "values", "a", "b", "c", "d", "e", "f", text);
  let wrong = 0, first = "";
  for (let round = 0; round < 3000; round++) {
    const row = () => [0, 1, 2, 3, 4, 5].map(k => launder(new classes[(round * 7 + k * 13) % classes.length](round + k)));
    const values = launder([round, 424242, 't' + round, null, 424242, true]);
    const mine = row(), theirs = row();
    let got, want;
    try { got = String(use(sink, values, ...mine)); } catch (error) { got = "threw " + error; }
    try { want = String(evaluated(sink, values, ...theirs)); } catch (error) { want = "threw " + error; }
    if (got !== want && !wrong++) first = "round " + round + ": " + got + " <> " + want;
  }
  cases++;
  if (wrong) { wrongCases++; console.log(name, "wrong", wrong, first); }
}
check("read", function (sink, values, a, b, c, d, e, f) { return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
check("read-a-name-that-some-have", function (sink, values, a, b, c, d, e, f) { return sink(a.w3, b.w3, c.w3, d.w3, e.w3, f.w3); }, "return sink(a.w3, b.w3, c.w3, d.w3, e.w3, f.w3);");
check("called", function (sink, values, a, b, c, d, e, f) { return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m()); }, "return sink(a.m(), b.m(), c.m(), d.m(), e.m(), f.m());");
check("getter", function (sink, values, a, b, c, d, e, f) { return sink(a.g, b.g, c.g, d.g, e.g, f.g); }, "return sink(a.g, b.g, c.g, d.g, e.g, f.g);");
check("stored", function (sink, values, a, b, c, d, e, f) { a.v = values[0]; b.v = values[1]; c.v = values[2]; d.v = values[3]; e.v = values[4]; f.v = values[5]; return sink(a.v, b.v, c.v, d.v, e.v, f.v); }, "a.v = values[0]; b.v = values[1]; c.v = values[2]; d.v = values[3]; e.v = values[4]; f.v = values[5]; return sink(a.v, b.v, c.v, d.v, e.v, f.v);");
check("stored-a-name-that-some-have", function (sink, values, a, b, c, d, e, f) { a.w3 = values[0]; b.w3 = values[1]; c.w3 = values[2]; d.w3 = values[3]; e.w3 = values[4]; f.w3 = values[5]; return sink(a.w3, b.w3, c.w3, d.w3, e.w3, f.w3, Object.keys(a).length, Object.keys(b).length, Object.keys(c).length, Object.keys(d).length, Object.keys(e).length, Object.keys(f).length); }, "a.w3 = values[0]; b.w3 = values[1]; c.w3 = values[2]; d.w3 = values[3]; e.w3 = values[4]; f.w3 = values[5]; return sink(a.w3, b.w3, c.w3, d.w3, e.w3, f.w3, Object.keys(a).length, Object.keys(b).length, Object.keys(c).length, Object.keys(d).length, Object.keys(e).length, Object.keys(f).length);");
check("asked", function (sink, values, a, b, c, d, e, f) { return sink('w3' in a, 'w3' in b, 'w3' in c, 'w3' in d, 'w3' in e, 'w3' in f); }, "return sink('w3' in a, 'w3' in b, 'w3' in c, 'w3' in d, 'w3' in e, 'w3' in f);");
console.log(cases, "cases,", wrongCases, "wrong");
