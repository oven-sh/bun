// Prints where a stack trace places the caller of a function expression that is called where it is written. The place follows the last statement of its body.
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
const inThisFile = /stack-positions-callers-function/;
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
async function showAsync(label, run) {
  try {
    await run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", placesOf(error).join(" "));
  }
}
show("(function () {})(fail());", () => { (function () {})(fail()); });
show("(function ({ x }) {})(nothing);", () => { (function ({ x }) {})(nothing); });
show("(({ x }) => {})(nothing);", () => { (({ x }) => {})(nothing); });
show("(function ({ x }) { })(nothing);", () => { (function ({ x }) { })(nothing); });
show("(function ({ x }) { /* c */ })(nothing);", () => { (function ({ x }) { /* c */ })(nothing); });
show("(function ({ x }) { ; })(nothing);", () => { (function ({ x }) { ; })(nothing); });
show("(function ({ x }) { return; })(nothing);", () => { (function ({ x }) { return; })(nothing); });
show("(function ({ x }) { let a; })(nothing);", () => { (function ({ x }) { let a; })(nothing); });
show("(function ({ x }) { let a = 1; })(nothing);", () => { (function ({ x }) { let a = 1; })(nothing); });
show("(function ({ x }) { let a = five; })(nothing);", () => { (function ({ x }) { let a = five; })(nothing); });
show("(function ({ x }) { var a; })(nothing);", () => { (function ({ x }) { var a; })(nothing); });
show("(function ({ x }) { if (five) { pass(1); } })(nothing);", () => { (function ({ x }) { if (five) { pass(1); } })(nothing); });
show("(function ({ x }) { if (five) pass(1); else {} })(nothing);", () => { (function ({ x }) { if (five) pass(1); else {} })(nothing); });
show("(function ({ x }) { for (;;) {} })(nothing);", () => { (function ({ x }) { for (;;) {} })(nothing); });
show("(function ({ x }) { while (five) {} })(nothing);", () => { (function ({ x }) { while (five) {} })(nothing); });
show("(function ({ x }) { while (five) pass(1); })(nothing);", () => { (function ({ x }) { while (five) pass(1); })(nothing); });
show("(function ({ x }) { {} })(nothing);", () => { (function ({ x }) { {} })(nothing); });
show("(function ({ x }) { { pass(1); } })(nothing);", () => { (function ({ x }) { { pass(1); } })(nothing); });
show("(function ({ x }) { try {} finally {} })(nothing);", () => { (function ({ x }) { try {} finally {} })(nothing); });
show("(function ({ x }) { try { pass(1); } catch {} })(nothing);", () => { (function ({ x }) { try { pass(1); } catch {} })(nothing); });
show("(function ({ x }) { try { pass(1); } catch (e) { pass(2); } })(nothing);", () => { (function ({ x }) { try { pass(1); } catch (e) { pass(2); } })(nothing); });
show("(function ({ x }) { switch (five) {} })(nothing);", () => { (function ({ x }) { switch (five) {} })(nothing); });
show("(function ({ x }) { switch (five) { case 1: pass(1); } })(nothing);", () => { (function ({ x }) { switch (five) { case 1: pass(1); } })(nothing); });
show("(function ({ x }) { function inner() {} })(nothing);", () => { (function ({ x }) { function inner() {} })(nothing); });
show("(function ({ x }) { pass(1); function inner() {} })(nothing);", () => { (function ({ x }) { pass(1); function inner() {} })(nothing); });
show("(function ({ x }) { return 1; })(nothing);", () => { (function ({ x }) { return 1; })(nothing); });
show("(function ({ x }) { return five; })(nothing);", () => { (function ({ x }) { return five; })(nothing); });
show("(function ({ x }) { throw 1; })(nothing);", () => { (function ({ x }) { throw 1; })(nothing); });
show("(function ({ x }) { a: pass(1); })(nothing);", () => { (function ({ x }) { a: pass(1); })(nothing); });
show("(function ({ x }) { do {} while (five); })(nothing);", () => { (function ({ x }) { do {} while (five); })(nothing); });
show("(function ({ x }) { for (const each of []) {} })(nothing);", () => { (function ({ x }) { for (const each of []) {} })(nothing); });
show("(function ({ x }) { for (const each in holder) pass(each); })(nothing);", () => { (function ({ x }) { for (const each in holder) pass(each); })(nothing); });
show("(function ({ x }) { \"use strict\"; })(nothing);", () => { (function ({ x }) { "use strict"; })(nothing); });
show("(function ({ x }) { debugger; })(nothing);", () => { (function ({ x }) { debugger; })(nothing); });
show("(function ({ x }) { const { a } = holder; })(nothing);", () => { (function ({ x }) { const { a } = holder; })(nothing); });
show("(function ({ x }) { let a = 1, b = five; })(nothing);", () => { (function ({ x }) { let a = 1, b = five; })(nothing); });
show("(function ({ x }) { return () => {}; })(nothing);", () => { (function ({ x }) { return () => {}; })(nothing); });
show("(function ({ x }) { return function () {}; })(nothing);", () => { (function ({ x }) { return function () {}; })(nothing); });
show("(function ({ x }) { return { a: 1 }; })(nothing);", () => { (function ({ x }) { return { a: 1 }; })(nothing); });
show("(({ x }) => ({}))(nothing);", () => { (({ x }) => ({}))(nothing); });
show("(({ x }) => [])(nothing);", () => { (({ x }) => [])(nothing); });
show("(({ x }) => () => {})(nothing);", () => { (({ x }) => () => {})(nothing); });
show("(function* ({ x }) {})(nothing);", () => { (function* ({ x }) {})(nothing); });
show("(async function ({ x }) {})(fail());", () => { (async function ({ x }) {})(fail()); });
show("holder[function () {}]();", () => { holder[function () {}](); });
show("holder[() => {}]();", () => { holder[() => {}](); });
show("holder[class {}]();", () => { holder[class {}](); });
show("holder[class { m() {} }]();", () => { holder[class { m() {} }](); });
show("holder[class { x = 1; }]();", () => { holder[class { x = 1; }](); });
show("(function () { fail(); if (five) { pass(1); } else { pass(2); } })();", () => { (function () { fail(); if (five) { pass(1); } else { pass(2); } })(); });
show("(function () { fail(); if (five) { pass(1); } else {} })();", () => { (function () { fail(); if (five) { pass(1); } else {} })(); });
show("(function () { fail(); if (five) {} else { pass(2); } })();", () => { (function () { fail(); if (five) {} else { pass(2); } })(); });
show("(function () { fail(); if (five) return; })();", () => { (function () { fail(); if (five) return; })(); });
show("(function () { fail(); if (five) return 1; })();", () => { (function () { fail(); if (five) return 1; })(); });
show("(function () { fail(); if (five) { return; } })();", () => { (function () { fail(); if (five) { return; } })(); });
show("(function () { fail(); if (five) { pass(1); pass(2); } })();", () => { (function () { fail(); if (five) { pass(1); pass(2); } })(); });
show("(function () { fail(); if (five) { let a = 1; pass(a); pass(a); } })();", () => { (function () { fail(); if (five) { let a = 1; pass(a); pass(a); } })(); });
show("(function () { fail(); if (pass(1)) {} })();", () => { (function () { fail(); if (pass(1)) {} })(); });
show("(function () { fail(); if (pass(1)) ; })();", () => { (function () { fail(); if (pass(1)) ; })(); });
show("(function () { fail(); if (five) pass(1); else if (key) pass(2); })();", () => { (function () { fail(); if (five) pass(1); else if (key) pass(2); })(); });
show("(function () { fail(); if (five) pass(1); else if (key) pass(2); else pass(3); })();", () => { (function () { fail(); if (five) pass(1); else if (key) pass(2); else pass(3); })(); });
show("(function () { fail(); for (;;) { break; } })();", () => { (function () { fail(); for (;;) { break; } })(); });
show("(function () { fail(); for (;;) { pass(1); break; } })();", () => { (function () { fail(); for (;;) { pass(1); break; } })(); });
show("(function () { fail(); for (;;) { if (five) continue; } })();", () => { (function () { fail(); for (;;) { if (five) continue; } })(); });
show("(function () { fail(); for (let i = 0; i < 1; i++) { pass(i); } })();", () => { (function () { fail(); for (let i = 0; i < 1; i++) { pass(i); } })(); });
show("(function () { fail(); for (let i = 0; i < 1; i++) {} })();", () => { (function () { fail(); for (let i = 0; i < 1; i++) {} })(); });
show("(function () { fail(); for (let i = 0; i < 1; i++) ; })();", () => { (function () { fail(); for (let i = 0; i < 1; i++) ; })(); });
show("(function () { fail(); while (five) ; })();", () => { (function () { fail(); while (five) ; })(); });
show("(function () { fail(); a: for (;;) { break a; } })();", () => { (function () { fail(); a: for (;;) { break a; } })(); });
show("(function () { fail(); a: { break a; } })();", () => { (function () { fail(); a: { break a; } })(); });
show("(function () { fail(); a: {} })();", () => { (function () { fail(); a: {} })(); });
show("(function () { fail(); switch (five) { case 1: break; } })();", () => { (function () { fail(); switch (five) { case 1: break; } })(); });
show("(function () { fail(); switch (five) { case 1: } })();", () => { (function () { fail(); switch (five) { case 1: } })(); });
show("(function () { fail(); switch (five) { default: } })();", () => { (function () { fail(); switch (five) { default: } })(); });
show("(function () { fail(); switch (five) { case 1: pass(1); break; default: pass(2); } })();", () => { (function () { fail(); switch (five) { case 1: pass(1); break; default: pass(2); } })(); });
show("(function () { fail(); switch (five) { case 1: { pass(1); } } })();", () => { (function () { fail(); switch (five) { case 1: { pass(1); } } })(); });
show("(function () { fail(); switch (five) { case 1: {} } })();", () => { (function () { fail(); switch (five) { case 1: {} } })(); });
show("(function () { fail(); try { pass(1); } finally { pass(2); } })();", () => { (function () { fail(); try { pass(1); } finally { pass(2); } })(); });
show("(function () { fail(); try { pass(1); } catch { pass(2); } finally {} })();", () => { (function () { fail(); try { pass(1); } catch { pass(2); } finally {} })(); });
show("(function () { fail(); try {} catch {} })();", () => { (function () { fail(); try {} catch {} })(); });
show("(function () { fail(); try { pass(1); } catch ({ a }) {} })();", () => { (function () { fail(); try { pass(1); } catch ({ a }) {} })(); });
show("(function () { fail(); function inner() { pass(1); } })();", () => { (function () { fail(); function inner() { pass(1); } })(); });
show("(function () { fail(); function inner() { return; } })();", () => { (function () { fail(); function inner() { return; } })(); });
show("(function () { fail(); function inner() {} pass(1); })();", () => { (function () { fail(); function inner() {} pass(1); })(); });
show("(function () { fail(); class A { m() {} } })();", () => { (function () { fail(); class A { m() {} } })(); });
show("(function () { fail(); class A { x = 1; } })();", () => { (function () { fail(); class A { x = 1; } })(); });
show("(function () { fail(); let a; })();", () => { (function () { fail(); let a; })(); });
show("(function () { fail(); let a, b; })();", () => { (function () { fail(); let a, b; })(); });
show("(function () { fail(); let a = 1, b; })();", () => { (function () { fail(); let a = 1, b; })(); });
show("(function () { fail(); let [a] = []; })();", () => { (function () { fail(); let [a] = []; })(); });
show("(function () { fail(); let { a } = {}; })();", () => { (function () { fail(); let { a } = {}; })(); });
show("(function () { fail(); let { a = 1 } = holder; })();", () => { (function () { fail(); let { a = 1 } = holder; })(); });
show("(function () { fail(); var a = function () {}; })();", () => { (function () { fail(); var a = function () {}; })(); });
show("(function () { fail(); var a = () => {}; pass(a, a); })();", () => { (function () { fail(); var a = () => {}; pass(a, a); })(); });
show("(function () { fail(); { let a = 1; pass(a, a); } })();", () => { (function () { fail(); { let a = 1; pass(a, a); } })(); });
show("(function () { fail(); { let a = five; } })();", () => { (function () { fail(); { let a = five; } })(); });
show("(function () { fail(); { function inner() {} } })();", () => { (function () { fail(); { function inner() {} } })(); });
show("(function () { fail(); do { pass(1); } while (five); })();", () => { (function () { fail(); do { pass(1); } while (five); })(); });
show("(function () { fail(); do pass(1); while (pass(five)); })();", () => { (function () { fail(); do pass(1); while (pass(five)); })(); });
show("(function () { fail(); return; pass(1); })();", () => { (function () { fail(); return; pass(1); })(); });
show("(function () { fail(); return 1; pass(1); })();", () => { (function () { fail(); return 1; pass(1); })(); });
show("(function () { fail(); throw 1; pass(1); })();", () => { (function () { fail(); throw 1; pass(1); })(); });
show("(function () { fail(); return; function inner() {} })();", () => { (function () { fail(); return; function inner() {} })(); });
show("(function () { fail(); 1; })();", () => { (function () { fail(); 1; })(); });
show("(function () { fail(); five; })();", () => { (function () { fail(); five; })(); });
show("(function () { fail(); \"a\"; })();", () => { (function () { fail(); "a"; })(); });
show("(function () { fail(); holder.s; })();", () => { (function () { fail(); holder.s; })(); });
show("(function () { fail(); pass; })();", () => { (function () { fail(); pass; })(); });
show("(function () { fail(); })();", () => { (function () { fail(); })(); });
show("(() => { fail(); if (five) { pass(1); } })();", () => { (() => { fail(); if (five) { pass(1); } })(); });
show("(() => { fail(); for (const each of []) { pass(each); } })();", () => { (() => { fail(); for (const each of []) { pass(each); } })(); });
show("(() => { fail(); return; })();", () => { (() => { fail(); return; })(); });
show("new (function () { fail(); if (five) { pass(1); } })();", () => { new (function () { fail(); if (five) { pass(1); } })(); });
show("new (class { constructor() { fail(); if (five) { pass(1); } } })();", () => { new (class { constructor() { fail(); if (five) { pass(1); } } })(); });
show("(function () { fail(); if (five) { pass(1); } }).call();", () => { (function () { fail(); if (five) { pass(1); } }).call(); });
show("(function () { fail(); if (five) { pass(1); } })``;", () => { (function () { fail(); if (five) { pass(1); } })``; });
show("pass(function () { fail(); if (five) { pass(1); } })();", () => { pass(function () { fail(); if (five) { pass(1); } })(); });
show("(five, function () { fail(); if (five) { pass(1); } })();", () => { (five, function () { fail(); if (five) { pass(1); } })(); });
show("(function () { fail(); if (five) { pass(1); } }.x.y);", () => { (function () { fail(); if (five) { pass(1); } }.x.y); });
show("(function () { if (five) { pass(1); } }).x.y;", () => { (function () { if (five) { pass(1); } }).x.y; });
show("(function () { fail(); { pass(1); pass(2); } })();", () => { (function () { fail(); { pass(1); pass(2); } })(); });
show("(function () { fail(); { pass(1); { pass(2); } } })();", () => { (function () { fail(); { pass(1); { pass(2); } } })(); });
show("(function () { fail(); { var a = five; } })();", () => { (function () { fail(); { var a = five; } })(); });
show("(function () { fail(); { const a = five; pass(1); } })();", () => { (function () { fail(); { const a = five; pass(1); } })(); });
show("(function () { fail(); { class A {} } })();", () => { (function () { fail(); { class A {} } })(); });
show("(function () { fail(); const a = 1; })();", () => { (function () { fail(); const a = 1; })(); });
show("(function () { fail(); const a = \"s\"; })();", () => { (function () { fail(); const a = "s"; })(); });
show("(function () { fail(); const a = five; })();", () => { (function () { fail(); const a = five; })(); });
show("(function () { fail(); pass(2); const a = 1; })();", () => { (function () { fail(); pass(2); const a = 1; })(); });
show("(function () { fail(); let a = 1; const b = 2; })();", () => { (function () { fail(); let a = 1; const b = 2; })(); });
show("(function () { fail(); if (pass(1)) {} else {} })();", () => { (function () { fail(); if (pass(1)) {} else {} })(); });
show("(function () { fail(); if (pass(1)) ; else pass(2); })();", () => { (function () { fail(); if (pass(1)) ; else pass(2); })(); });
show("(function () { fail(); if (pass(1)) ; else ; })();", () => { (function () { fail(); if (pass(1)) ; else ; })(); });
show("(function () { fail(); if (pass(1)) pass(2); else ; })();", () => { (function () { fail(); if (pass(1)) pass(2); else ; })(); });
show("(function () { fail(); if (1) { pass(1); } })();", () => { (function () { fail(); if (1) { pass(1); } })(); });
show("(function () { fail(); if (0) { pass(1); } })();", () => { (function () { fail(); if (0) { pass(1); } })(); });
show("(function () { fail(); if (0) pass(1); else pass(2); })();", () => { (function () { fail(); if (0) pass(1); else pass(2); })(); });
show("(function () { fail(); if (1) pass(1); else pass(2); })();", () => { (function () { fail(); if (1) pass(1); else pass(2); })(); });
show("(function () { fail(); for (;;) ; })();", () => { (function () { fail(); for (;;) ; })(); });
show("(function () { fail(); for (pass(1);;) ; })();", () => { (function () { fail(); for (pass(1);;) ; })(); });
show("(function () { fail(); for (; pass(1);) ; })();", () => { (function () { fail(); for (; pass(1);) ; })(); });
show("(function () { fail(); for (let i = 0;;) ; })();", () => { (function () { fail(); for (let i = 0;;) ; })(); });
show("(function () { fail(); for (const each of holder.arr) ; })();", () => { (function () { fail(); for (const each of holder.arr) ; })(); });
show("(function () { fail(); for (const each in holder) ; })();", () => { (function () { fail(); for (const each in holder) ; })(); });
show("(function () { fail(); for (const each of pass(holder.arr)) ; })();", () => { (function () { fail(); for (const each of pass(holder.arr)) ; })(); });
show("(function () { fail(); switch (five) { case 1: case 2: } })();", () => { (function () { fail(); switch (five) { case 1: case 2: } })(); });
show("(function () { fail(); switch (five) { case 1: pass(1); default: } })();", () => { (function () { fail(); switch (five) { case 1: pass(1); default: } })(); });
show("(function () { fail(); switch (five) { case pass(1): } })();", () => { (function () { fail(); switch (five) { case pass(1): } })(); });
show("(function () { fail(); switch (five) { case 1: ; } })();", () => { (function () { fail(); switch (five) { case 1: ; } })(); });
show("(function () { fail(); switch (five) { case 1: five; } })();", () => { (function () { fail(); switch (five) { case 1: five; } })(); });
show("(function () { fail(); switch (pass(five)) {} })();", () => { (function () { fail(); switch (pass(five)) {} })(); });
show("(function () { fail(); a: ; })();", () => { (function () { fail(); a: ; })(); });
show("(function () { fail(); a: b: pass(1); })();", () => { (function () { fail(); a: b: pass(1); })(); });
show("(function () { fail(); return; var a = 1; })();", () => { (function () { fail(); return; var a = 1; })(); });
show("(function () { fail(); return; let a = 1; })();", () => { (function () { fail(); return; let a = 1; })(); });
show("(function () { fail(); return; class A {} })();", () => { (function () { fail(); return; class A {} })(); });
show("(function () { fail(); if (five) { return; pass(1); } })();", () => { (function () { fail(); if (five) { return; pass(1); } })(); });
show("(function () { fail(); while (five) { pass(1); continue; } })();", () => { (function () { fail(); while (five) { pass(1); continue; } })(); });
show("(function () { fail(); try { pass(1); } catch (e) {} finally { five; } })();", () => { (function () { fail(); try { pass(1); } catch (e) {} finally { five; } })(); });
show("(function () { fail(); try { pass(1); } catch (e) { five; } })();", () => { (function () { fail(); try { pass(1); } catch (e) { five; } })(); });
show("(function () { fail(); function inner(a = 1) {} })();", () => { (function () { fail(); function inner(a = 1) {} })(); });
show("(function () { fail(); function inner(a, b) {} })();", () => { (function () { fail(); function inner(a, b) {} })(); });
show("(function () { fail(); function inner(a, { b }, ...c) {} })();", () => { (function () { fail(); function inner(a, { b }, ...c) {} })(); });
show("(function () { fail(); function inner(a = {}, ) {} })();", () => { (function () { fail(); function inner(a = {}, ) {} })(); });
show("(function () { fail(); async function inner() {} })();", () => { (function () { fail(); async function inner() {} })(); });
show("(function () { fail(); function* inner() {} })();", () => { (function () { fail(); function* inner() {} })(); });
show("(function () { fail(); return { m() {} }; })();", () => { (function () { fail(); return { m() {} }; })(); });
show("(function () { fail(); return { get m() { return 1; } }; })();", () => { (function () { fail(); return { get m() { return 1; } }; })(); });
show("(function () { fail(); return class { m() {} }; })();", () => { (function () { fail(); return class { m() {} }; })(); });
show("(function () { fail(); return async () => {}; })();", () => { (function () { fail(); return async () => {}; })(); });
show("(function () { fail(); return async function () {}; })();", () => { (function () { fail(); return async function () {}; })(); });
show("(function () { fail(); return a => {}; })();", () => { (function () { fail(); return a => {}; })(); });
show("(function () { fail(); return (a, b) => {}; })();", () => { (function () { fail(); return (a, b) => {}; })(); });
show("(function () { fail(); let a = 1; a++; })();", () => { (function () { fail(); let a = 1; a++; })(); });
show("(function () { fail(); let a = 1; ++a; })();", () => { (function () { fail(); let a = 1; ++a; })(); });
show("(function () { fail(); let a = 1; a = 2; })();", () => { (function () { fail(); let a = 1; a = 2; })(); });
show("(function () { fail(); let a = 1; a += five; })();", () => { (function () { fail(); let a = 1; a += five; })(); });
show("(function () { fail(); let a = five; pass(a); })();", () => { (function () { fail(); let a = five; pass(a); })(); });
show("(function () { fail(); let a = pass(1); return a; })();", () => { (function () { fail(); let a = pass(1); return a; })(); });
show("(function () { fail(); delete holder.zz; })();", () => { (function () { fail(); delete holder.zz; })(); });
show("(function () { fail(); holder.zz = 1; })();", () => { (function () { fail(); holder.zz = 1; })(); });
show("(function () { fail(); new Made; })();", () => { (function () { fail(); new Made; })(); });
show("(function () { fail(); id`a`; })();", () => { (function () { fail(); id`a`; })(); });
show("(function () { fail(); `a${pass(1)}b`; })();", () => { (function () { fail(); `a${pass(1)}b`; })(); });
show("(function () { fail(); five ? pass(1) : pass(2); })();", () => { (function () { fail(); five ? pass(1) : pass(2); })(); });
show("(function () { fail(); five && pass(1); })();", () => { (function () { fail(); five && pass(1); })(); });
show("(function () { fail(); typeof pass(1); })();", () => { (function () { fail(); typeof pass(1); })(); });
show("(function () { fail(); !pass(1); })();", () => { (function () { fail(); !pass(1); })(); });
show("(function () { fail(); pass(1), pass(2); })();", () => { (function () { fail(); pass(1), pass(2); })(); });
show("(function () { fail(); pass(1) + 1; })();", () => { (function () { fail(); pass(1) + 1; })(); });
show("(function () { fail(); 1 + pass(1); })();", () => { (function () { fail(); 1 + pass(1); })(); });
show("(function () { fail(); holder.s + holder.f; })();", () => { (function () { fail(); holder.s + holder.f; })(); });
show("(function () { fail(); yes: { if (five) break yes; pass(1); } })();", () => { (function () { fail(); yes: { if (five) break yes; pass(1); } })(); });
show("over several lines, ends with an if", () => {
  (function () {
    fail();
    if (five) {
      pass(1);
    }
  })();
});
show("over several lines, ends with a loop", () => {
  (() => {
    fail();
    for (const each of holder.arr) {
      pass(each);
    }
  })();
});
show("over several lines, ends with a try", () => {
  (function () {
    fail();
    try {
      pass(1);
    } catch (error) {
      pass(error);
    } finally {
    }
  })();
});
show("over several lines, ends with a declaration", () => {
  (function () {
    fail();
    function inner() {
    }
  })();
});
show("over several lines, empty", () => {
  (function ({ x }) {
  })(nothing);
});
await showAsync("async function g({ x }) {} await g(nothing);", async () => { async function g({ x }) {} await g(nothing); });
await showAsync("async function g({ x }) { return 1; } await g(nothing);", async () => { async function g({ x }) { return 1; } await g(nothing); });
await showAsync("async function g({ x }) { let next = 1; next++; } await g(nothing);", async () => { async function g({ x }) { let next = 1; next++; } await g(nothing); });
await showAsync("async function g({ x }) { try { return 1; } finally { } } await g(nothing);", async () => { async function g({ x }) { try { return 1; } finally { } } await g(nothing); });
await showAsync("async function g({ x }) { if (five) { pass(1); } } await g(nothing);", async () => { async function g({ x }) { if (five) { pass(1); } } await g(nothing); });
await showAsync("const each = { async g({ x }) { for (;;) {} } }; await each.g(nothing);", async () => { const each = { async g({ x }) { for (;;) {} } }; await each.g(nothing); });
await showAsync("await (async ({ x }) => {})(nothing);", async () => { await (async ({ x }) => {})(nothing); });
await showAsync("await (async ({ x }) => 1)(nothing);", async () => { await (async ({ x }) => 1)(nothing); });
await showAsync("await (async () => { fail(); if (five) { pass(1); } })();", async () => { await (async () => { fail(); if (five) { pass(1); } })(); });
await showAsync("await (async () => { await 1; fail(); if (five) { pass(1); } })();", async () => { await (async () => { await 1; fail(); if (five) { pass(1); } })(); });
await showAsync("await (async function () { fail(); for (const each of []) {} })();", async () => { await (async function () { fail(); for (const each of []) {} })(); });
