// Prints where a stack trace places what throws in a statement that holds the only use of a function that the block around it declares, or of a variable of a `case`.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-functions-blocks-declare/;
function placesOf(error) {
  return String(error.stack).split("\n").filter(line => inThisFile.test(line)).map(line => /:(\d+:\d+)\)?$/.exec(line)[1]);
}
function show(label, run) {
  try {
    run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
  }
}
function showRejection(error) {
  console.log("rejected |", error.constructor.name, "|", placesOf(error).slice(0, -2).join(" "));
}
async function showAsync(label, run) {
  try {
    await run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).join(" "));
  }
}
show("try { function g({ x }) {} g(nothing); } finally {}", () => { try { function g({ x }) {} g(nothing); } finally {} });
show("if (five) { function g() { fail(); } g(); }", () => { if (five) { function g() { fail(); } g(); } });
show("{ function g() { fail(); } g(); }", () => { { function g() { fail(); } g(); } });
show("for (;;) { function g() { fail(); } g(); }", () => { for (;;) { function g() { fail(); } g(); } });
show("switch (five) { case 5: function g() { fail(); } g(); }", () => { switch (five) { case 5: function g() { fail(); } g(); } });
show("{ g(); function g() { fail(); } }", () => { { g(); function g() { fail(); } } });
show("{ function a() { fail(); } function b() { a(); } b(); }", () => { { function a() { fail(); } function b() { a(); } b(); } });
show("{ function a() { fail(); } function b(f) { f(); } b(a); }", () => { { function a() { fail(); } function b(f) { f(); } b(a); } });
show("{ function g() { fail(); } pass(g)(); }", () => { { function g() { fail(); } pass(g)(); } });
show("{ function g() { fail(); } [1].map(g); }", () => { { function g() { fail(); } [1].map(g); } });
show("{ function g() { fail(); } new g(); }", () => { { function g() { fail(); } new g(); } });
show("{ function g() { fail(); } new g; }", () => { { function g() { fail(); } new g; } });
show("{ function g() { fail(); } const r = g(); pass(r); pass(r); }", () => { { function g() { fail(); } const r = g(); pass(r); pass(r); } });
show("{ function g() { fail(); } throw g(); }", () => { { function g() { fail(); } throw g(); } });
show("{ function g() { fail(); } if (g()) pass(1); }", () => { { function g() { fail(); } if (g()) pass(1); } });
show("{ function g() { fail(); } pass(1); g(); }", () => { { function g() { fail(); } pass(1); g(); } });
show("{ function g() { fail(); } five; g(); }", () => { { function g() { fail(); } five; g(); } });
show("{ function g() { fail(); } const c = 1; g(c); }", () => { { function g() { fail(); } const c = 1; g(c); } });
show("{ function g() { fail(); } let c = five; g(c); }", () => { { function g() { fail(); } let c = five; g(c); } });
show("{ function g() { fail(); } g(); g(); }", () => { { function g() { fail(); } g(); g(); } });
show("{ function g() { return nothing; } g().x; }", () => { { function g() { return nothing; } g().x; } });
show("{ function g() { return nothing; } g()(); }", () => { { function g() { return nothing; } g()(); } });
show("{ function g() { return 1; } g.x.y; }", () => { { function g() { return 1; } g.x.y; } });
show("{ function g() { return 1; } g.x(); }", () => { { function g() { return 1; } g.x(); } });
show("{ function g() { return 1; } g`a`.x.y; }", () => { { function g() { return 1; } g`a`.x.y; } });
show("{ function g() { return 1; } nothing[g]; }", () => { { function g() { return 1; } nothing[g]; } });
show("{ function g() { return 1; } pass(g).x.y; }", () => { { function g() { return 1; } pass(g).x.y; } });
show("{ function g() { return 1; } g instanceof five; }", () => { { function g() { return 1; } g instanceof five; } });
show("{ function g() { return 1; } five in g.x; }", () => { { function g() { return 1; } five in g.x; } });
show("{ function g() { return 1; } [...g]; }", () => { { function g() { return 1; } [...g]; } });
show("{ function g() { return 1; } symbol + g; }", () => { { function g() { return 1; } symbol + g; } });
show("{ function g() { return 1; } `${g}${symbol}`; }", () => { { function g() { return 1; } `${g}${symbol}`; } });
show("{ function g(a = fail()) { return 1; } g(); }", () => { { function g(a = fail()) { return 1; } g(); } });
show("{ function g() { return 1; } class A extends g.x {} }", () => { { function g() { return 1; } class A extends g.x {} } });
show("{ function* g() { fail(); } g().next(); }", () => { { function* g() { fail(); } g().next(); } });
show("{ async function g() { fail(); } g().catch(showRejection); fail(); }", () => { { async function g() { fail(); } g().catch(showRejection); fail(); } });
show("{ function g() { let next = 1; next++; fail(); } g(); }", () => { { function g() { let next = 1; next++; fail(); } g(); } });
show("{ function g() { if (five) { fail(); } } g(); }", () => { { function g() { if (five) { fail(); } } g(); } });
show("{ function g() { fail(); return; } g(); }", () => { { function g() { fail(); return; } g(); } });
show("{ function g() { fail(); function inner() {} } g(); }", () => { { function g() { fail(); function inner() {} } g(); } });
show("{ function g() { try { fail(); } finally { } } g(); }", () => { { function g() { try { fail(); } finally { } } g(); } });
show("{ function g() { fail(); } ({ a: g }).a(); }", () => { { function g() { fail(); } ({ a: g }).a(); } });
show("{ function g() { fail(); } const each = { g }; each.g(); each.g(); }", () => { { function g() { fail(); } const each = { g }; each.g(); each.g(); } });
show("{ function g() { fail(); } g.call(null); }", () => { { function g() { fail(); } g.call(null); } });
show("{ function g() { fail(); } g?.(); }", () => { { function g() { fail(); } g?.(); } });
show("{ function g() { fail(); } (0, g)(); }", () => { { function g() { fail(); } (0, g)(); } });
show("{ function g() { fail(); } five && g(); }", () => { { function g() { fail(); } five && g(); } });
show("{ function g() { fail(); } five ? g() : 0; }", () => { { function g() { fail(); } five ? g() : 0; } });
show("{ function g() { fail(); } holder.s = g(); }", () => { { function g() { fail(); } holder.s = g(); } });
show("{ function g() { fail(); } key = g(); }", () => { { function g() { fail(); } key = g(); } });
show("{ { function g() { fail(); } g(); } }", () => { { { function g() { fail(); } g(); } } });
show("while (five) { function g() { fail(); } g(); }", () => { while (five) { function g() { fail(); } g(); } });
show("for (const a of [1]) { function g() { fail(); } g(a); }", () => { for (const a of [1]) { function g() { fail(); } g(a); } });
show("try { fail(); } catch { function g() { fail(); } g(); }", () => { try { fail(); } catch { function g() { fail(); } g(); } });
show("try { } finally { function g() { fail(); } g(); }", () => { try { } finally { function g() { fail(); } g(); } });
show("if (!five) {} else { function g() { fail(); } g(); }", () => { if (!five) {} else { function g() { fail(); } g(); } });
show("l: { function g() { fail(); } g(); }", () => { l: { function g() { fail(); } g(); } });
show("{ function g() { g.x.y; } g(); }", () => { { function g() { g.x.y; } g(); } });
show("switch (five) { case 5: const a = fail; a(); }", () => { switch (five) { case 5: const a = fail; a(); } });
show("switch (five) { case 1: pass(1); break; case 5: const a = function () { fail(); }; a(); }", () => { switch (five) { case 1: pass(1); break; case 5: const a = function () { fail(); }; a(); } });
show("switch (five) { case 1: pass(1); break; default: let a = holder.nested; a.deep.x; }", () => { switch (five) { case 1: pass(1); break; default: let a = holder.nested; a.deep.x; } });
show("switch (five) { case 5: { function g() { fail(); } g(); } }", () => { switch (five) { case 5: { function g() { fail(); } g(); } } });
show("switch (five) { case 1: function inner() {} case 5: function g() { fail(); } g(); }", () => { switch (five) { case 1: function inner() {} case 5: function g() { fail(); } g(); } });
show("const g = function () { fail(); }; const c = 1; g(c);", () => { const g = function () { fail(); }; const c = 1; g(c); });
show("const g = function () { fail(); }; let c = five; g(c);", () => { const g = function () { fail(); }; let c = five; g(c); });
show("const g = function () { fail(); }; let c = pass(five); g(c);", () => { const g = function () { fail(); }; let c = pass(five); g(c); });
show("const g = () => { fail(); }; let c = five, d = five; g(c, d);", () => { const g = () => { fail(); }; let c = five, d = five; g(c, d); });
show("let a = holder.nested, b = five; pass(b, a.deep.x);", () => { let a = holder.nested, b = five; pass(b, a.deep.x); });
show("let a = holder, b = pass; b(a.nested.deep.x);", () => { let a = holder, b = pass; b(a.nested.deep.x); });
show("{ function g() { fail(); } let c = pass(five); g(c); }", () => { { function g() { fail(); } let c = pass(five); g(c); } });
show("{ const c = 1; pass(c); g(c); function g() { fail(); } }", () => { { const c = 1; pass(c); g(c); function g() { fail(); } } });
show("{ const c = 1; g(c + c); function g() { fail(); } }", () => { { const c = 1; g(c + c); function g() { fail(); } } });
show("if (five) { function g() { fail(); } function inner() { return 1; } g(inner()); }", () => { if (five) { function g() { fail(); } function inner() { return 1; } g(inner()); } });
show("if (five) { function g() { return 1; } function inner() { fail(); } pass(g(), inner()); }", () => { if (five) { function g() { return 1; } function inner() { fail(); } pass(g(), inner()); } });
show("class A { m() { { function g() { fail(); } g(); } } } new A().m();", () => { class A { m() { { function g() { fail(); } g(); } } } new A().m(); });
show("class A { static { function g() { fail(); } g(); } }", () => { class A { static { function g() { fail(); } g(); } } });
show("class A { static { { function g() { fail(); } g(); } } }", () => { class A { static { { function g() { fail(); } g(); } } } });
show("over several lines", () => {
  if (five) {
    function declared(value) {
      if (value) {
        fail();
      }
    }
    declared(
      pass(1),
    );
  }
});
show("over several lines, declared behind its use", () => {
  for (const each of holder.arr) {
    pass(
      declared(each),
    );
    function declared(value) {
      fail();
      return value;
    }
  }
});
show("over several lines, in a case", () => {
  switch (five) {
    case 1:
      pass(1);
      break;
    case 5:
      const once = function (value) {
        fail();
        return value;
      };
      pass(once(1));
      break;
  }
});
await showAsync("{ function g() { fail(); } await g(); }", async () => { { function g() { fail(); } await g(); } });
await showAsync("{ function g() { fail(); } await 1; g(); }", async () => { { function g() { fail(); } await 1; g(); } });
await showAsync("{ async function g() { await 1; fail(); } await g(); }", async () => { { async function g() { await 1; fail(); } await g(); } });
