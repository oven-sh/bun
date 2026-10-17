// `using` in the head of a loop, with four and five resources, and what a disposer's throw does to each kind of completion.
const out = globalThis.console ? console.log : print;
let log = [];
const res = name => ({ [Symbol.dispose]() { log.push("d" + name); } });
const thr = name => ({ [Symbol.dispose]() { log.push("d" + name); throw "D" + name; } });
const boom = name => { log.push("i" + name); throw "I" + name; };
const show = e => e instanceof SuppressedError ? "S(" + show(e.error) + "/" + show(e.suppressed) + ")" : e instanceof Error ? e.name : e === undefined ? "undefined" : typeof e === "object" && e !== null ? "object" : typeof e === "function" ? "fn" : String(e);
function say(name, f) { log = []; let r; try { r = "-> " + show(f()); } catch (e) { r = "THROWN " + show(e); } out(name + ": " + r + " | " + log.join(" ")); }
// An iterable that says when it is asked for the next and when it is closed.
const seq = (...items) => ({ [Symbol.iterator]() { let i = 0; return { next() { log.push("n" + i); return i < items.length ? { done: false, value: items[i++] } : { done: true, value: undefined }; }, return() { log.push("closed"); return {}; } }; } });
const exits = ["none", "break", "continue", "return", "throw"];

for (const exit of exits) for (const at of [0, 1]) {
  say("for (using x of ..), " + exit + " in round " + at, () => {
    let round = 0;
    for (using x of seq(res("1"), res("2"), res("3"))) {
      log.push("b" + round);
      if (round++ === at) { if (exit === "break") break; if (exit === "continue") continue; if (exit === "return") return "R"; if (exit === "throw") throw "B"; }
      log.push("e");
    }
    return "end";
  });
  say("for (using x of ..), the disposer of round 1 throws, " + exit + " in round " + at, () => {
    let round = 0;
    for (using x of seq(res("1"), thr("2"), res("3"))) {
      log.push("b" + round);
      if (round++ === at) { if (exit === "break") break; if (exit === "continue") continue; if (exit === "return") return "R"; if (exit === "throw") throw "B"; }
      log.push("e");
    }
    return "end";
  });
  say("for (using x = .., y = ..; ..; ..), " + exit + " in round " + at, () => {
    let round = 0;
    for (using x = res("x"), y = res("y"); round < 3; log.push("u")) {
      log.push("b" + round);
      if (round++ === at) { if (exit === "break") break; if (exit === "continue") continue; if (exit === "return") return "R"; if (exit === "throw") throw "B"; }
      log.push("e");
    }
    return "end";
  });
  say("a head in a head, " + exit + " of the outer from the inner in round " + at, () => {
    let round = 0;
    outer: for (using x of seq(res("o1"), res("o2"))) {
      for (using y of seq(res("i1"), thr("i2"))) {
        log.push("b" + round);
        if (round++ === at) { if (exit === "break") break outer; if (exit === "continue") continue outer; if (exit === "return") return "R"; if (exit === "throw") throw "B"; }
      }
    }
    return "end";
  });
  say("a block in a case, " + exit + " at " + at, () => {
    for (let k = 0; k < 2; k++) {
      switch (k + at) {
        case 0: { using a = res("a"); log.push("c0"); if (exit === "break") break; if (exit === "continue") continue; if (exit === "return") return "R"; if (exit === "throw") throw "B"; log.push("e0"); }
        case 1: { using b = thr("b"), c = res("c"); log.push("c1"); if (exit === "break") break; if (exit === "continue") continue; if (exit === "return") return "R"; }
        default: { using d = res("d"); log.push("cd"); }
      }
      log.push("after");
    }
    return "end";
  });
}
say("for (using x of ..) with null and undefined among them", () => { for (using x of seq(null, res("1"), undefined)) log.push("b" + (x === null ? "null" : x === undefined ? "undefined" : "res")); return "end"; });
say("for (using x of ..) with what has no method", () => { for (using x of seq(res("1"), {}, res("3"))) log.push("b"); return "end"; });
say("for (using x of ..) with a number", () => { for (using x of seq(res("1"), 7)) log.push("b"); return "end"; });
say("for (using x of ..), closures keep each round's own", () => { const fs = []; for (using x of seq(res("1"), res("2"))) fs.push(() => x); log.push(fs[0]() !== fs[1]() ? "two" : "one"); return fs.length; });
say("for (using x = ..;;) whose second initializer throws", () => { for (using x = res("x"), y = boom("y"); ; ) log.push("never"); });
say("for (using x = ..; test throws;)", () => { for (using x = res("x"); boom("t"); ) log.push("never"); });
say("for (using x = ..;; update throws)", () => { for (using x = thr("x"); ; boom("u")) log.push("b"); });

// Up to four are taken in place, five are not: the same rows on both sides of the limit.
const kinds = { "all good": i => res(i), "all throw": i => thr(i), "the odd ones throw": i => i & 1 ? thr(i) : res(i), "the first throws": i => i === 1 ? thr(i) : res(i), "the last throws": (i, n) => i === n ? thr(i) : res(i) };
for (const [kind, make] of Object.entries(kinds)) for (const body of ["ends", "throws", "returns"]) {
  const end = () => { log.push("body"); if (body === "throws") throw "B"; return body === "returns" ? "R" : undefined; };
  say("one, " + kind + ", the body " + body, () => { using a = make(1, 1); return end(); });
  say("three, " + kind + ", the body " + body, () => { using a = make(1, 3), b = make(2, 3), c = make(3, 3); return end(); });
  say("four, " + kind + ", the body " + body, () => { using a = make(1, 4), b = make(2, 4), c = make(3, 4), d = make(4, 4); return end(); });
  say("five, " + kind + ", the body " + body, () => { using a = make(1, 5), b = make(2, 5), c = make(3, 5), d = make(4, 5), e = make(5, 5); return end(); });
  say("four in four declarations, " + kind + ", the body " + body, () => { using a = make(1, 4); log.push("s"); using b = make(2, 4); log.push("s"); using c = make(3, 4); log.push("s"); using d = make(4, 4); return end(); });
}
for (let failing = 1; failing <= 5; failing++) {
  const at = i => i === failing ? boom(i) : thr(i);
  say("four, the initializer of " + failing + " throws, every disposer too", () => { using a = at(1), b = at(2), c = at(3), d = at(4); log.push("body"); return "R"; });
  say("five, the initializer of " + failing + " throws, every disposer too", () => { using a = at(1), b = at(2), c = at(3), d = at(4), e = at(5); log.push("body"); return "R"; });
}

// The returned value is computed before the disposal; a disposer's throw replaces every completion.
say("the value returned is worked out first", () => { let v = 1; using a = { [Symbol.dispose]() { log.push("d"); v = 2; } }; return v; });
say("the value returned is an object that the disposer changes", () => { const o = { toString() { return "o" + this.v; }, v: 1 }; const r = (() => { using a = { [Symbol.dispose]() { o.v = 2; } }; return o; })(); return String(r); });
say("a disposer throws over a break", () => { L: { using a = thr("a"); break L; } return "after"; });
say("a disposer throws over a continue", () => { for (let i = 0; i < 2; i++) { using a = thr("a" + i); continue; } return "after"; });
say("a disposer throws undefined", () => { using a = { [Symbol.dispose]() { throw undefined; } }; return "R"; });
say("a disposer throws undefined over a thrown undefined", () => { using a = { [Symbol.dispose]() { throw undefined; } }; throw undefined; });
say("in try, caught, and again in the catch", () => { try { using a = thr("a"); throw "B"; } catch (e) { log.push("c" + show(e)); using b = thr("b"); throw "C"; } finally { using c = res("c"); log.push("f"); } });
say("in finally, over a return", () => { try { return "R"; } finally { using a = thr("a"); log.push("f"); } });
say("in finally, which returns itself", () => { try { throw "B"; } finally { using a = res("a"); return "F"; } });

// Disposers that use `using`, that dispose of one another, that come twice.
say("a disposer with a `using` of its own", () => { using a = { [Symbol.dispose]() { using b = res("b"), c = thr("c"); log.push("da"); throw "DA"; } }; log.push("body"); throw "B"; });
say("the same resource twice", () => { const r = res("r"); using a = r, b = r; return "R"; });
say("a resource that changes its method once it is declared", () => { const r = res("old"); using a = r; r[Symbol.dispose] = () => log.push("new"); return "R"; });
say("the method is read once, by a getter, where it is declared", () => { using a = { get [Symbol.dispose]() { log.push("get"); return () => log.push("d"); } }; log.push("body"); return "R"; });
say("`this` of the method", () => { const r = { [Symbol.dispose]() { log.push(this === r ? "this" : "other"); } }; using a = r; return "R"; });
say("recursion with a `using` at every depth", () => { const f = n => { using a = n & 1 ? thr(n) : res(n); if (n) return f(n - 1); throw "B"; }; return f(4); });

// Classes.
say("in a static block", () => { class C { static { using a = res("a"); log.push("static"); } } return "R"; });
say("in a static block, the disposer throws", () => { class C { static { using a = thr("a"); log.push("static"); } } return "R"; });
say("in a constructor, ahead of super()", () => { class B { constructor() { log.push("B"); } } class D extends B { constructor() { using a = res("a"); super(); log.push("D"); } } new D; return "R"; });
say("in a constructor that never calls super()", () => { class B {} class D extends B { constructor() { using a = res("a"); log.push("D"); } } new D; return "R"; });
say("in a getter, a setter and a method", () => { const o = { get g() { using a = res("g"); return 1; }, set s(v) { using a = res("s"); }, m() { using a = res("m"); return 2; } }; o.s = o.g + o.m(); return "R"; });
say("in a field's initializer", () => { class C { f = (() => { using a = res("a"); return 1; })(); } return new C().f; });
say("in an arrow in a default parameter", () => { const f = (x = (() => { using a = res("a"); return 5; })()) => x; return f(); });
