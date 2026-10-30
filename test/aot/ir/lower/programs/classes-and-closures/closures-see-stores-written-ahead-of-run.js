// RUN: lower
// OPTIONS: builtin-modules

// Each function makes a closure over `v` and stores to `v`. The store runs behind the making of the closure, which must read what was stored, and in many of them it is written ahead of it: in a pattern left of its value, in an outer pattern behind an inner one, in the head of a loop, in a clause of a switch, in a class.
function check(name, run) {
  let shown;
  try {
    shown = String(run());
  } catch (error) {
    shown = "throws " + error;
  }
  console.log(name + ": " + shown);
}

// Patterns in assignments.
check("array default", () => { let v = 1, g, x; [g, x = v = 2] = [() => v]; return g(); });
check("object default", () => { let v = 1, g, x; ({ g, x = v = 2 } = { g: () => v }); return g(); });
check("object computed key", () => { let v = 1, g; ({ [(v = 2, "g")]: g } = { g: () => v }); return g(); });
check("nested array", () => { let v = 1, g, x; [[x = v = 2], g] = [[], () => v]; return g(); });
check("nested object", () => { let v = 1, g, x; [g, { x = v = 2 }] = [() => v, {}]; return g(); });
check("rest pattern", () => { let v = 1, g, x; [g, ...[x = v = 2]] = [() => v]; return g(); });
check("object rest", () => { let v = 1, g, r; ({ g, [(v = 2, "k")]: r, ...r } = { g: () => v }); return g(); });
check("element target", () => { let v = 1, a = []; [a[(v = 2, 0)]] = [() => v]; return a[0](); });
check("property target", () => { let v = 1, a = []; ({ x: a[(v = 2, 0)] } = { x: () => v }); return a[0](); });
check("chained", () => { let v = 1, g, x, y; y = [g, x = v = 2] = [() => v]; return g(); });
check("compound default", () => { let v = 1, g, x; [g, x = v += 5] = [() => v]; return g(); });
check("update default", () => { let v = 1, g, x; [g, x = v++] = [() => v]; return g(); });
check("prefix default", () => { let v = 1, g, x; [g, x = --v] = [() => v]; return g(); });
check("target is the name", () => { let v = 1, g; [g, v] = [() => v, 2]; return g(); });
check("target is the name first", () => { let v = 1, g; [v, g] = [2, () => v]; return g(); });
check("closure in target, store on right", () => { let v = 1, g, a = []; [a[(g = () => v, 0)]] = [v = 2]; return g(); });
check("closure in default, store in later default", () => { let v = 1, g, x; [[g = () => v], x = (v = 2)] = [[]]; return g(); });
check("store to the name with a closure in its default", () => { let v = 1, g; [v = (g = () => v, 2)] = []; return g(); });
check("shorthand with a closure in its default", () => { let v = 1, g; ({ v = (g = () => v, 2) } = {}); return g(); });
check("pattern in argument", () => { let v = 1, g, x; String([g, x = v = 2] = [() => v]); return g(); });
check("pattern in condition", () => { let v = 1, g, x; if ([g, x = v = 2] = [() => v]) return g(); });
check("pattern in pattern default", () => { let v = 1, g, x, y; [y = [g, x = v = 2] = [() => v]] = []; return g(); });
check("two closures", () => { let v = 1, g, h, x; [g, x = v = 2, h] = [() => v, undefined, () => v + 10]; return g() + "," + h(); });
check("closure behind a call on the right", () => { let v = 1, g, x; const make = f => [f]; [g, x = v = 2] = make(() => v); return g(); });
check("method on the right", () => { let v = 1, g, x; ({ g, x = v = 2 } = { g() { return v; } }); return g(); });
check("function expression on the right", () => { let v = 1, g, x; [g, x = v = 2] = [function () { return v; }]; return g(); });
check("class on the right", () => { let v = 1, C, x; [C, x = v = 2] = [class { static read() { return v; } }]; return C.read(); });
check("closure of a closure", () => { let v = 1, g, x; [g, x = v = 2] = [() => () => v]; return g()(); });

// Patterns in declarations.
check("let default", () => { let v = 1; let [g, x = v = 2] = [() => v]; return g(); });
check("let nested before default", () => { let v = 1; let [[g = () => v], y = (v = 2)] = [[]]; return g(); });
check("let two nested", () => { let v = 1; let [[g = () => v], [y = (v = 2)]] = [[], []]; return g(); });
check("let three nested", () => { let v = 1; let [[g = () => v], [y = (v = 2)], [z = (v = 3)]] = [[], [], []]; return g(); });
check("const object nested before default", () => { let v = 1; const { a: { g = () => v }, y = (v = 2) } = { a: {} }; return g(); });
check("const object nested before key", () => { let v = 1; const { a: [g = () => v], [(v = 2, "b")]: y } = { a: [] }; return g(); });
check("var nested before default", () => { let v = 1; var [[g = () => v], y = (v = 2)] = [[]]; return g(); });
check("let nested before rest", () => { let v = 1; let [[g = () => v], ...[y = (v = 2)]] = [[]]; return g(); });
check("let nested with default before default", () => { let v = 1; let { a: { g = () => v } = {}, y = (v = 2) } = {}; return g(); });
check("let deep", () => { let v = 1; let [[[[g = () => v]]], { y = (v = 2) }] = [[[[]]], {}]; return g(); });
check("let element default then nested", () => { let v = 1; let [[g, x = v = 2] = [() => v]] = []; return g(); });
check("let name read by earlier closure", () => { let [[g = () => y], y = 2] = [[]]; return g(); });
check("let name read by earlier closure, flat", () => { let [g = () => y, y = 2] = []; return g(); });
check("two declarators", () => { let v = 1; let [g = () => v] = [], [y = (v = 2)] = []; return g(); });

// Parameters.
check("parameter nested before default", () => (function (v, [[g = () => v], y = (v = 2)]) { return g(); })(1, [[]]));
check("parameter two nested", () => (function (v, [[g = () => v], [y = (v = 2)]]) { return g(); })(1, [[], []]));
check("parameter object nested before key", () => (function (v, { a: [g = () => v], [(v = 2, "b")]: y }) { return g(); })(1, { a: [] }));
check("parameter then parameter", () => (function (v, g = () => v, x = v = 2) { return g(); })(1));
check("parameter store then closure", () => (function (v, x = (v = 2), g = () => v) { return g(); })(1));
check("parameter closure, body store", () => (function (v, g = () => v) { v = 2; return g(); })(1));
check("parameter closure, body var", () => (function (v, g = () => v) { var v = 2; return g(); })(1));
check("parameter closure reads later parameter", () => (function (g = () => v, v = 2) { return g(); })());
check("parameter default then its pattern", () => ((v, [g, x = v = 2] = [() => v]) => g())(1));
check("arrow parameter nested", () => ((v, [[g = () => v], y = (v = 2)]) => g())(1, [[]]));
check("method parameter nested", () => ({ m(v, [[g = () => v], y = (v = 2)]) { return g(); } }).m(1, [[]]));

// Heads of for-of and for-in.
check("for-of assignment pattern", () => { let v = 1, g, x; for ([g, x = v = 2] of [[() => v]]); return g(); });
check("for-of let pattern", () => { let v = 1, g; for (let [h, x = v = 2] of [[() => v]]) g = h; return g(); });
check("for-of var pattern", () => { let v = 1, g; for (var [h, x = v = 2] of [[() => v]]) g = h; return g(); });
check("for-of const nested", () => { let v = 1, g; for (const [[h = () => v], y = (v = 2)] of [[[]]]) g = h; return g(); });
check("for-of element target", () => { let v = 1, g, a = []; for (a[(v = 2, 0)] of [g = () => v]); return g(); });
check("for-in element target", () => { let v = 1, g, a = []; for (a[(v = 2, 0)] in { k: (g = () => v) }); return g(); });
check("for-in pattern", () => { let v = 1, g, x; for ({ [(v = 2, "length")]: x } in { k: (g = () => v) }); return g() + "," + x; });
check("for-in let pattern", () => { let v = 1, g; for (let { length: n = 0, [(v = 2, "x")]: x } in { k: (g = () => v) }); return g(); });
check("for-of closure in head, store in body", () => { let v = 1, g; for (const [h = () => v] of [[]]) { g = h; v = 2; } return g(); });
check("for-of store in head of second turn", () => { let v = 1, g, x; for ([x = (v += 1)] of [[], []]) g ??= () => v; return g(); });

// Loops.
check("for update", () => { let v = 1, g; for (let i = 0; i < 1; i++, v = 2) g = () => v; return g(); });
check("for test", () => { let v = 1, g; for (let i = 0; (i && (v = 2), i < 1); i++) g = () => v; return g(); });
check("for earlier branch", () => { let v = 1, g; for (let i = 0; i < 2; i++) { if (i === 1) v = 2; else g = () => v; } return g(); });
check("while earlier branch", () => { let v = 1, g, i = 0; while (i < 2) { if (i === 1) v = 2; else g = () => v; i++; } return g(); });
check("do earlier branch", () => { let v = 1, g, i = 0; do { if (i === 1) v = 2; else g = () => v; i++; } while (i < 2); return g(); });
check("labelled continue", () => {
  let v = 1, g;
  outer: for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      if (i === 1) { v = 2; continue outer; }
      g = () => v;
      continue outer;
    }
  }
  return g();
});
check("labelled continue of a while", () => {
  let v = 1, g, i = 0;
  outer: while (i < 2) {
    i++;
    do {
      if (g) { v = 2; continue outer; }
      g = () => v;
    } while (false);
  }
  return g();
});
check("for init closure", () => { let g; for (let i = 0, h = () => i; i < 2; i++) g = h; return g(); });
check("for body closure", () => { const list = []; for (let i = 0; i < 3; i++) list.push(() => i); return list.map(f => f()); });
check("for body closure with a store", () => { const list = []; for (let i = 0; i < 3; i++) { list.push(() => i); i += 0; } return list.map(f => f()); });

// Compound and logical assignments.
check("or-assign", () => { let v = 1, g, a; g = () => v; a ||= (v = 2); return g(); });
check("or-assign to the name", () => { let v = 0, g; v ||= (g = () => v, 2); return g(); });
check("and-assign to the name", () => { let v = 1, g; v &&= (g = () => v, 2); return g(); });
check("nullish-assign to the name", () => { let v = null, g; v ??= (g = () => v, 2); return g(); });
check("add-assign to the name", () => { let v = 1, g; v += (g = () => v, 1); return g(); });
check("assign to the name", () => { let v = 1, g; v = (g = () => v, 2); return g(); });
check("power-assign to the name", () => { let v = 2, g; v **= (g = () => v, 3); return g(); });

// Member targets.
check("key store then closure", () => { let v = 1, a = []; a[v = 2] = () => v; return a[2](); });
check("key closure then store", () => { let v = 1, g, a = []; a[(g = () => v, 0)] = (v = 2); return g(); });
check("object closure then key store", () => { let v = 1, g, a = []; (g = () => v, a)[v = 2] = 0; return g(); });
check("compound member", () => { let v = 1, g, a = [0]; a[(g = () => v, 0)] += (v = 2); return g(); });

// Calls, templates, literals.
const tag = (strings, ...values) => values;
check("tagged template", () => { let v = 1, g; tag`${g = () => v}${v = 2}`; return g(); });
check("tagged template, store in the tag", () => { let v = 1, g; (v = 2, tag)`${g = () => v}`; return g(); });
check("template", () => { let v = 1, g; `${g = () => v}${v = 2}`; return g(); });
check("arguments", () => { let v = 1, g; String(g = () => v, v = 2); return g(); });
check("new arguments", () => { let v = 1, g; new (g = () => v, Object)(v = 2); return g(); });
check("object literal", () => { let v = 1, g; ({ [(g = () => v, "a")]: (v = 2) }); return g(); });
check("array literal with spread", () => { let v = 1, g; [g = () => v, ...(v = 2, [])]; return g(); });
check("conditional", () => { let v = 1, g; (g = () => v) ? (v = 2) : 0; return g(); });
check("optional chain", () => { let v = 1, g; (g = () => v)?.[v = 2]; return g(); });

// Classes.
check("static field before computed name", () => { let v = 1, g; class C { static a = (v = 2); [(g = () => v, "b")]() {} } return g(); });
check("static block before computed name", () => { let v = 1, g; class C { static { v = 2; } [(g = () => v, "b")]() {} } return g(); });
check("computed name before static field", () => { let v = 1, g; class C { [(g = () => v, "a")]() {} static b = (v = 2); } return g(); });
check("heritage before computed name", () => { let v = 1, g; class C extends (g = () => v, Object) { [(v = 2, "a")]() {} } return g(); });
check("static closure before computed name", () => { let v = 1; class C { static g = () => v; [(v = 2, "x")]() {} } return C.g(); });
check("static closure before static store", () => { let v = 1; class C { static g = () => v; static x = (v = 2); } return C.g(); });
check("static closure before later store", () => { let v = 1; class C { static g = () => v; } v = 2; return C.g(); });
check("field store, static closure", () => { let v = 1; class C { a = (v = 2); static g = () => v; } new C(); return C.g(); });
check("method before computed name", () => { let v = 1; class C { static m() { return v; } [(v = 2, "a")]() {} } return C.m(); });
check("constructor before computed name", () => { let v = 1, g; class C { constructor() { g = () => v; } [(v = 2, "a")]() {} } new C(); return g(); });
check("field closure before computed name", () => { let v = 1; class C { g = () => v; [(v = 2, "a")]() {} } return new C().g(); });
check("computed field names", () => { let v = 1, g; class C { [(g = () => v, "a")] = 1; static [(v = 2, "b")] = 2; } return g(); });
check("class expression in a pattern default", () => { let v = 1, C, x; [C = class { static g = () => v; }, x = (v = 2)] = []; return C.g(); });
check("accessor names", () => { let v = 1, g; class C { get [(g = () => v, "a")]() { return 0; } set [(v = 2, "a")](value) {} } return g(); });

// switch.
check("default clause before a test", () => { let v = 1, g; switch (9) { default: v = 2; break; case (g = () => v, 0): } return g(); });
check("clause before a test", () => { let v = 1, g; switch (1) { case 0: v = 5; break; case (g = () => v, 1): v = 2; } return g(); });
check("fall through", () => { let v = 1, g; switch (0) { case 0: g = () => v; case 1: v = 2; } return g(); });
check("switch in a loop", () => { let v = 1, g; for (const k of [1, 0]) switch (k) { case 0: v = 2; break; case 1: g = () => v; } return g(); });
check("discriminant", () => { let v = 1, g; switch (g = () => v) { case (v = 2): } return g(); });

// try.
check("finally behind return", () => { let v = 1; const f = () => { try { return () => v; } finally { v = 2; } }; return f()(); });
check("finally behind return in one function", () => (function () { let v = 1; try { return () => v; } finally { v = 2; } })()());
check("finally behind catch", () => { let v = 1, g; try { throw 0; } catch { g = () => v; } finally { v = 2; } return g(); });
check("catch behind finally", () => { let v = 1, g; try { try { throw 0; } finally { g = () => v; } } catch { v = 2; } return g(); });
check("catch pattern nested", () => { let v = 1, h; try { throw [[]]; } catch ([[g = () => v], y = (v = 2)]) { h = g; } return h(); });
check("finally behind break", () => { let v = 1, g; for (;;) { try { g = () => v; break; } finally { v = 2; } } return g(); });
check("finally behind continue", () => { let v = 1, g; for (let i = 0; i < 2; i++) { try { if (!g) { g = () => v; continue; } } finally { v += 1; } } return g(); });

// Generators and async functions.
check("generator store behind yield", () => { function* make() { let v = 1; yield () => v; v = 2; } const it = make(); const g = it.next().value; it.next(); return g(); });
check("generator finally on return", () => { function* make() { let v = 1; try { yield () => v; } finally { v = 2; } } const it = make(); const g = it.next().value; it.return(); return g(); });
check("generator pattern with yield", () => { function* make() { let v = 1, g, x; [g, x = v = yield g] = [() => v]; } const it = make(); const g = it.next().value; it.next(2); return g(); });
check("generator sent value", () => { function* make() { let v = 1; v = yield () => v; } const it = make(); const g = it.next().value; it.next(2); return g(); });
check("generator loop", () => { function* make() { let v = 0; for (;;) { v++; yield () => v; } } const it = make(); const g = it.next().value; it.next(); return g(); });
check("generator parameter", () => { function* make(v, [[g = () => v], y = (v = 2)]) { yield g; } return make(1, [[]]).next().value(); });

// Function declarations.
check("hoisted function", () => { let v = 1; const r = g; v = 2; return r(); function g() { return v; } });
check("hoisted function in a block", () => { let v = 1, r; { r = g; v = 2; function g() { return v; } } return r(); });
check("hoisted function behind the store", () => { let v = 1; v = 2; return g(); function g() { return v; } });

async function later() {
  const show = (name, value) => console.log(name + ": " + value);
  {
    let v = 1, g, x;
    [g, x = v = await 2] = [() => v];
    show("await in a default", g());
  }
  {
    let v = 1, g, x;
    for await ([g, x = v = 2] of [[() => v]]);
    show("for-await pattern", g());
  }
  {
    let v = 1;
    const [[g = () => v], y = (v = await 2)] = [[]];
    show("await in a declared default", g());
  }
  {
    let v = 1;
    const g = () => v;
    await null;
    v = 2;
    show("store behind await", g());
  }
  {
    const f = async (v, [[g = () => v], y = (v = 2)]) => g;
    show("async parameter nested", (await f(1, [[]]))());
  }
}
await later();

// Names declared with var.
check("var declared twice", () => { var v = 1; var g = () => v; var v = 2; return g(); });
check("var pattern declares the name again", () => { var v = 1; var [[g = () => v], v = 2] = [[]]; return g(); });
check("var in a pattern read by an earlier closure", () => { var [g = () => v, v = 2] = []; return g(); });
check("var of a for-of head", () => { const list = []; for (var x of [1, 2]) list.push(() => x); return list.map(f => f()); });
check("var stored by its declarator in a loop", () => { const list = []; for (let i = 0; i < 2; i++) { var x = i; list.push(() => x); } return list.map(f => f()); });
check("hoisted function makes the closure", () => { let v = 1; const r = h(); v = 2; return r(); function h() { return () => v; } });

// Names that are read before they hold a value.
check("nested default reads a later name", () => { let [[a = b], b = 1] = [[]]; return a; });
check("key reads a later name", () => { let { [b]: a, b } = {}; return a; });
check("later nested default reads an earlier name", () => { let [b = 1, [a = b]] = [undefined, []]; return a; });
check("for-of reads its own name", () => { for (let x of [x]); });
check("for-of default reads a later name", () => { for (let [a = b, b] of [[]]); });
check("parameter reads a later name", () => (function (a = b, b) { return a; })());
check("nested parameter reads a later name", () => (function ([[a = b]], b = 1) { return a; })([[]]));
check("computed name reads the class", () => { class C { static a = 1; [C.a]() {} } });
check("static field reads the class", () => { class C { static a = C.name; } return C.a; });
check("switch clause skipped", () => { switch (1) { case 0: let a = 1; case 1: return a; } });

// The same at the top of the module and in a block there.
let topValue = 1, topClosure, topOther;
[topClosure, topOther = topValue = 2] = [() => topValue];
console.log("top of the module: " + topClosure());
{
  let v = 1, g, x;
  [g, x = v = 2] = [() => v];
  console.log("block at the top: " + g());
  let w = 1;
  let [[h = () => w], y = (w = 2)] = [[]];
  console.log("declared in a block at the top: " + h());
}
for (const turn of [0, 1]) {
  let v = 1, g, x;
  [g, x = v = 2] = [() => v];
  console.log("loop at the top: " + g());
}

// GENERATED: tag read m
// CHECK-LABEL: function {{*}}name="tag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] length=1 thisType={type=anything} parameters=[{type=anything}, {type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_2]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="v"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|Array<undefined|null|number|Array<undefined|null|[[f_4]]>> flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|Array<undefined|null|number|Array<undefined|null|[[f_4]]>>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewObject layout=[[L_6]]
// CHECK-NEXT: PutEnvironmentField v2, v0 layout=[[L_6]]
// CHECK-NEXT: v4 = IteratorOpen v1 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b19():
// CHECK-NEXT: v5 = IteratorResume v4 stepIndex=0
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: v8 = IteratorOpen v7 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b18():
// CHECK-NEXT: v9 = IteratorResume v8 stepIndex=0
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: v12 = TypeTest v11 testedType=undefined
// CHECK-NEXT: Branch v12 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v13) handler=b18():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b18():
// CHECK-NEXT: v14 = NewClosure v2 function=[[f_7]]
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b6(v15) handler=b18():
// CHECK-NEXT: Jump -> next b7(v15)
// CHECK-NEXT: b7(v16) handler=b18():
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b18():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b19():
// CHECK-NEXT: IteratorClose v8
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10() handler=b19():
// CHECK-NEXT: v19 = IteratorResume v4 stepIndex=1
// CHECK-NEXT: v20 = ResultAt v19
// CHECK-NEXT: v21 = ResultAt v19 index=1
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b11(| 0), notTaken b13(| 0)
// CHECK-NEXT: b11(v23) handler=b19():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b19():
// CHECK-NEXT: v24 = GetEnvironmentField v2 layout=[[L_6]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="v"
// CHECK-NEXT: v26 = Integer integer=2
// CHECK-NEXT: PutEnvironmentField v2, v26 layout=[[L_6]]
// CHECK-NEXT: Jump -> next b14(v26)
// CHECK-NEXT: b13(v28) handler=b19():
// CHECK-NEXT: Jump -> next b14(v28)
// CHECK-NEXT: b14(v29) handler=b19():
// CHECK-NEXT: v30 = Convert v29 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15() handler=b19():
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: IteratorClose v4
// CHECK-NEXT: Jump -> next b17()
// CHECK-NEXT: b17():
// CHECK-NEXT: v32 = Call v17 calleeName="g"
// CHECK-NEXT: ReturnCall v32 casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-NEXT: b18() role=IterationCleanup subject=v8 handler=b19():
// CHECK-NEXT: v33 = CatchException
// CHECK-NEXT: IteratorClose v8 completion=Throw
// CHECK-NEXT: Rethrow v33
// CHECK-NEXT: b19() role=IterationCleanup subject=v4:
// CHECK-NEXT: v35 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_8]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: env [[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="v"
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
