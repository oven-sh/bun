// RUN: lower
// OPTIONS: builtin-modules

// A conversion in a template has no place of its own in a stack trace: it stands where the last operation in front of it stands, in the order in which JavaScriptCore writes them.
// Prints that place behind every kind of statement, behind names of built-ins, stores to variables that closures hold, constants and spreads.
function pass(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function Made() {}
function Thrower() {
  throw new Error("Thrower");
}
const nothing = null;
const missing = undefined;
const symbol = Symbol("symbol");
const holder = { a: null, f: 5, s: "text", arr: [1], nested: { deep: null }, g() { return { h: 1 }; }, m() { throw new Error("m"); } };
let five = 5;
let key = "nope";
const inThisFile = /stack-positions-conversions-loops-stores/;
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
show("for (const a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a of holder.arr) { } return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr) { } return `${{ toString: () => fail() }}`; });
show("for (const a of holder.arr) pass(a); return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr) pass(a); return `${{ toString: () => fail() }}`; });
show("for (const a of pass(holder.arr)) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a of pass(holder.arr)) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a of [1, 2]) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a of [1, 2]) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const [a] of [[1]]) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const [a] of [[1]]) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const { a } of [{ a: 1 }]) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const { a } of [{ a: 1 }]) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a of holder.arr) { pass(() => a); } return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr) { pass(() => a); } return `${{ toString: () => fail() }}`; });
show("for (let a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (let a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (var a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (var a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (key of holder.arr) { pass(key); } return `${{ toString: () => fail() }}`;", () => { for (key of holder.arr) { pass(key); } return `${{ toString: () => fail() }}`; });
show("for (holder.f of holder.arr) { pass(1); } return `${{ toString: () => fail() }}`;", () => { for (holder.f of holder.arr) { pass(1); } return `${{ toString: () => fail() }}`; });
show("for (const a of holder.arr) { if (a) break; } return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr) { if (a) break; } return `${{ toString: () => fail() }}`; });
show("for (const a of holder.arr) { if (a) continue; pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr) { if (a) continue; pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a of holder.arr) { for (const b of holder.arr) { pass(b); } } return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr) { for (const b of holder.arr) { pass(b); } } return `${{ toString: () => fail() }}`; });
show("for (const a of new Map([[1, 2]])) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a of new Map([[1, 2]])) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a of holder.arr.map(pass)) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a of holder.arr.map(pass)) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a in holder) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a in holder) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a in holder) { } return `${{ toString: () => fail() }}`;", () => { for (const a in holder) { } return `${{ toString: () => fail() }}`; });
show("for (const a in pass(holder)) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a in pass(holder)) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a in { x: pass(1) }) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (const a in { x: pass(1) }) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (const a in holder) { pass(() => a); } return `${{ toString: () => fail() }}`;", () => { for (const a in holder) { pass(() => a); } return `${{ toString: () => fail() }}`; });
show("for (var a in holder) { pass(a); } return `${{ toString: () => fail() }}`;", () => { for (var a in holder) { pass(a); } return `${{ toString: () => fail() }}`; });
show("for (key in holder) { pass(key); } return `${{ toString: () => fail() }}`;", () => { for (key in holder) { pass(key); } return `${{ toString: () => fail() }}`; });
show("for (let i = 0; i < 2; i++) { pass(i); } return `${{ toString: () => fail() }}`;", () => { for (let i = 0; i < 2; i++) { pass(i); } return `${{ toString: () => fail() }}`; });
show("for (let i = 0; i < pass(2); i++) { pass(i); } return `${{ toString: () => fail() }}`;", () => { for (let i = 0; i < pass(2); i++) { pass(i); } return `${{ toString: () => fail() }}`; });
show("for (let i = pass(0); i < 2; i++) { } return `${{ toString: () => fail() }}`;", () => { for (let i = pass(0); i < 2; i++) { } return `${{ toString: () => fail() }}`; });
show("for (let i = 0; i < 2; i = pass(i + 1)) { pass(i); } return `${{ toString: () => fail() }}`;", () => { for (let i = 0; i < 2; i = pass(i + 1)) { pass(i); } return `${{ toString: () => fail() }}`; });
show("for (let i = 0; i < 2; i++) { pass(() => i); } return `${{ toString: () => fail() }}`;", () => { for (let i = 0; i < 2; i++) { pass(() => i); } return `${{ toString: () => fail() }}`; });
show("for (let i = 0; i < holder.arr.length; i++) { pass(i); } return `${{ toString: () => fail() }}`;", () => { for (let i = 0; i < holder.arr.length; i++) { pass(i); } return `${{ toString: () => fail() }}`; });
show("for (let i = 0; ; i++) { if (pass(i)) break; } return `${{ toString: () => fail() }}`;", () => { for (let i = 0; ; i++) { if (pass(i)) break; } return `${{ toString: () => fail() }}`; });
show("for (;;) { pass(1); break; } return `${{ toString: () => fail() }}`;", () => { for (;;) { pass(1); break; } return `${{ toString: () => fail() }}`; });
show("for (var i = 0; i < 2; i++) pass(i); return `${{ toString: () => fail() }}`;", () => { for (var i = 0; i < 2; i++) pass(i); return `${{ toString: () => fail() }}`; });
show("let w = 0; while (w++ < 2) { pass(w); } return `${{ toString: () => fail() }}`;", () => { let w = 0; while (w++ < 2) { pass(w); } return `${{ toString: () => fail() }}`; });
show("let w = 0; while (pass(w++) < 2) { pass(w); } return `${{ toString: () => fail() }}`;", () => { let w = 0; while (pass(w++) < 2) { pass(w); } return `${{ toString: () => fail() }}`; });
show("let w = 0; while (w < holder.arr.length) { w++; } return `${{ toString: () => fail() }}`;", () => { let w = 0; while (w < holder.arr.length) { w++; } return `${{ toString: () => fail() }}`; });
show("let w = 0; while (true) { if (pass(w++)) break; } return `${{ toString: () => fail() }}`;", () => { let w = 0; while (true) { if (pass(w++)) break; } return `${{ toString: () => fail() }}`; });
show("let w = 0; do { pass(w); } while (w++ < 2); return `${{ toString: () => fail() }}`;", () => { let w = 0; do { pass(w); } while (w++ < 2); return `${{ toString: () => fail() }}`; });
show("let w = 0; do { pass(w); } while (pass(w++) < 2); return `${{ toString: () => fail() }}`;", () => { let w = 0; do { pass(w); } while (pass(w++) < 2); return `${{ toString: () => fail() }}`; });
show("if (five) { pass(1); } return `${{ toString: () => fail() }}`;", () => { if (five) { pass(1); } return `${{ toString: () => fail() }}`; });
show("if (!five) { pass(1); } else { pass(2); } return `${{ toString: () => fail() }}`;", () => { if (!five) { pass(1); } else { pass(2); } return `${{ toString: () => fail() }}`; });
show("if (pass(five)) { pass(1); } else if (pass(1)) { pass(2); } return `${{ toString: () => fail() }}`;", () => { if (pass(five)) { pass(1); } else if (pass(1)) { pass(2); } return `${{ toString: () => fail() }}`; });
show("if (pass(0)) { pass(1); } return `${{ toString: () => fail() }}`;", () => { if (pass(0)) { pass(1); } return `${{ toString: () => fail() }}`; });
show("switch (pass(five)) { case pass(5): pass(1); break; case pass(6): pass(2); } return `${{ toString: () => fail() }}`;", () => { switch (pass(five)) { case pass(5): pass(1); break; case pass(6): pass(2); } return `${{ toString: () => fail() }}`; });
show("try { pass(1); } catch (e) { pass(2); } return `${{ toString: () => fail() }}`;", () => { try { pass(1); } catch (e) { pass(2); } return `${{ toString: () => fail() }}`; });
show("try { pass(1); } catch { pass(2); } return `${{ toString: () => fail() }}`;", () => { try { pass(1); } catch { pass(2); } return `${{ toString: () => fail() }}`; });
show("try { pass(1); } finally { pass(2); } return `${{ toString: () => fail() }}`;", () => { try { pass(1); } finally { pass(2); } return `${{ toString: () => fail() }}`; });
show("try { pass(1); } catch (e) { pass(2); } finally { pass(3); } return `${{ toString: () => fail() }}`;", () => { try { pass(1); } catch (e) { pass(2); } finally { pass(3); } return `${{ toString: () => fail() }}`; });
show("try { fail(); } catch (e) { pass(2); } return `${{ toString: () => fail() }}`;", () => { try { fail(); } catch (e) { pass(2); } return `${{ toString: () => fail() }}`; });
show("try { fail(); } catch ({ message }) { pass(message); } return `${{ toString: () => fail() }}`;", () => { try { fail(); } catch ({ message }) { pass(message); } return `${{ toString: () => fail() }}`; });
show("try { } finally { pass(2); } return `${{ toString: () => fail() }}`;", () => { try { } finally { pass(2); } return `${{ toString: () => fail() }}`; });
show("l: { if (pass(1)) break l; pass(2); } return `${{ toString: () => fail() }}`;", () => { l: { if (pass(1)) break l; pass(2); } return `${{ toString: () => fail() }}`; });
show("{ pass(1); } return `${{ toString: () => fail() }}`;", () => { { pass(1); } return `${{ toString: () => fail() }}`; });
show("{ let a = pass(1); pass(a, a); } return `${{ toString: () => fail() }}`;", () => { { let a = pass(1); pass(a, a); } return `${{ toString: () => fail() }}`; });
show("class A { m() { pass(1); } } return `${{ toString: () => fail() }}`;", () => { class A { m() { pass(1); } } return `${{ toString: () => fail() }}`; });
show("class A { static x = pass(1); } return `${{ toString: () => fail() }}`;", () => { class A { static x = pass(1); } return `${{ toString: () => fail() }}`; });
show("class A { static { pass(1); } } return `${{ toString: () => fail() }}`;", () => { class A { static { pass(1); } } return `${{ toString: () => fail() }}`; });
show("class A { x = pass(1); } new A(); return `${{ toString: () => fail() }}`;", () => { class A { x = pass(1); } new A(); return `${{ toString: () => fail() }}`; });
show("class A extends pass(Object) { } return `${{ toString: () => fail() }}`;", () => { class A extends pass(Object) { } return `${{ toString: () => fail() }}`; });
show("class A { [pass(\"m\")]() { } } return `${{ toString: () => fail() }}`;", () => { class A { [pass("m")]() { } } return `${{ toString: () => fail() }}`; });
show("function g() { pass(1); } return `${{ toString: () => fail() }}`;", () => { function g() { pass(1); } return `${{ toString: () => fail() }}`; });
show("function g() { pass(1); } g(); g(); return `${{ toString: () => fail() }}`;", () => { function g() { pass(1); } g(); g(); return `${{ toString: () => fail() }}`; });
show("const g = () => pass(1); g(); g(); return `${{ toString: () => fail() }}`;", () => { const g = () => pass(1); g(); g(); return `${{ toString: () => fail() }}`; });
show("const a = pass(1) ? pass(2) : pass(3); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = pass(1) ? pass(2) : pass(3); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = pass(0) && pass(2); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = pass(0) && pass(2); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = pass(0) || pass(2); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = pass(0) || pass(2); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = pass(null) ?? pass(2); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = pass(null) ?? pass(2); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = holder?.g?.(); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = holder?.g?.(); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = nothing?.g(pass(1)); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = nothing?.g(pass(1)); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const { a = pass(1) } = holder; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const { a = pass(1) } = holder; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const [a = pass(1)] = holder.arr; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const [a = pass(1)] = holder.arr; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const [a, ...b] = holder.arr; pass(a, b, a, b); return `${{ toString: () => fail() }}`;", () => { const [a, ...b] = holder.arr; pass(a, b, a, b); return `${{ toString: () => fail() }}`; });
show("const { a, ...b } = holder; pass(a, b, a, b); return `${{ toString: () => fail() }}`;", () => { const { a, ...b } = holder; pass(a, b, a, b); return `${{ toString: () => fail() }}`; });
show("const a = [...o.arr]; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = [...o.arr]; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = { ...o }; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = { ...o }; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = pass(...o.arr); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = pass(...o.arr); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = new pass(...o.arr); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = new pass(...o.arr); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = `${pass(1)}`; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = `${pass(1)}`; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = id`x${1}`; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = id`x${1}`; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = typeof pass(1); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = typeof pass(1); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = (pass(1), pass(2)); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = (pass(1), pass(2)); pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = function () { pass(1); }; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = function () { pass(1); }; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = class { static x = pass(1); }; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = class { static x = pass(1); }; pass(a, a); return `${{ toString: () => fail() }}`; });
show("const a = holder.arr.map(x => pass(x)); pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = holder.arr.map(x => pass(x)); pass(a, a); return `${{ toString: () => fail() }}`; });
show("key = pass(1); return `${{ toString: () => fail() }}`;", () => { key = pass(1); return `${{ toString: () => fail() }}`; });
show("key += pass(1); return `${{ toString: () => fail() }}`;", () => { key += pass(1); return `${{ toString: () => fail() }}`; });
show("key ||= pass(1); return `${{ toString: () => fail() }}`;", () => { key ||= pass(1); return `${{ toString: () => fail() }}`; });
show("key &&= pass(1); return `${{ toString: () => fail() }}`;", () => { key &&= pass(1); return `${{ toString: () => fail() }}`; });
show("key ??= pass(1); return `${{ toString: () => fail() }}`;", () => { key ??= pass(1); return `${{ toString: () => fail() }}`; });
show("key++; return `${{ toString: () => fail() }}`;", () => { key++; return `${{ toString: () => fail() }}`; });
show("holder.f = pass(1); return `${{ toString: () => fail() }}`;", () => { holder.f = pass(1); return `${{ toString: () => fail() }}`; });
show("holder.f += pass(1); return `${{ toString: () => fail() }}`;", () => { holder.f += pass(1); return `${{ toString: () => fail() }}`; });
show("holder.f++; return `${{ toString: () => fail() }}`;", () => { holder.f++; return `${{ toString: () => fail() }}`; });
show("holder[key] = pass(1); return `${{ toString: () => fail() }}`;", () => { holder[key] = pass(1); return `${{ toString: () => fail() }}`; });
show("holder[key]++; return `${{ toString: () => fail() }}`;", () => { holder[key]++; return `${{ toString: () => fail() }}`; });
show("delete holder.zz; return `${{ toString: () => fail() }}`;", () => { delete holder.zz; return `${{ toString: () => fail() }}`; });
show("[key] = holder.arr; return `${{ toString: () => fail() }}`;", () => { [key] = holder.arr; return `${{ toString: () => fail() }}`; });
show("({ s: key } = holder); return `${{ toString: () => fail() }}`;", () => { ({ s: key } = holder); return `${{ toString: () => fail() }}`; });
show("void pass(1); return `${{ toString: () => fail() }}`;", () => { void pass(1); return `${{ toString: () => fail() }}`; });
show("holder.s; return `${{ toString: () => fail() }}`;", () => { holder.s; return `${{ toString: () => fail() }}`; });
show("holder.nested.deep; return `${{ toString: () => fail() }}`;", () => { holder.nested.deep; return `${{ toString: () => fail() }}`; });
show("holder[key]; return `${{ toString: () => fail() }}`;", () => { holder[key]; return `${{ toString: () => fail() }}`; });
show("var v = pass(1); return `${{ toString: () => fail() }}`;", () => { var v = pass(1); return `${{ toString: () => fail() }}`; });
show("let t; return `${{ toString: () => fail() }}`;", () => { let t; return `${{ toString: () => fail() }}`; });
show("throw0: try { throw pass(1); } catch { } return `${{ toString: () => fail() }}`;", () => { throw0: try { throw pass(1); } catch { } return `${{ toString: () => fail() }}`; });
show("label: for (const a of holder.arr) { for (const b of holder.arr) { continue label; } } return `${{ toString: () => fail() }}`;", () => { label: for (const a of holder.arr) { for (const b of holder.arr) { continue label; } } return `${{ toString: () => fail() }}`; });
show("Number(`${{ toString: () => fail() }}`);", () => { Number(`${{ toString: () => fail() }}`); });
show("Math.max(1, `${{ toString: () => fail() }}`.length);", () => { Math.max(1, `${{ toString: () => fail() }}`.length); });
show("Object.values({ a: `${{ toString: () => fail() }}` });", () => { Object.values({ a: `${{ toString: () => fail() }}` }); });
show("String(`${{ toString: () => fail() }}`);", () => { String(`${{ toString: () => fail() }}`); });
show("JSON.stringify(`${{ toString: () => fail() }}`);", () => { JSON.stringify(`${{ toString: () => fail() }}`); });
show("Array.from(`${{ toString: () => fail() }}`);", () => { Array.from(`${{ toString: () => fail() }}`); });
show("parseInt(`${{ toString: () => fail() }}`);", () => { parseInt(`${{ toString: () => fail() }}`); });
show("Symbol(`${{ toString: () => fail() }}`);", () => { Symbol(`${{ toString: () => fail() }}`); });
show("new Error(`${{ toString: () => fail() }}`);", () => { new Error(`${{ toString: () => fail() }}`); });
show("Promise.resolve(`${{ toString: () => fail() }}`);", () => { Promise.resolve(`${{ toString: () => fail() }}`); });
show("globalThis.String(`${{ toString: () => fail() }}`);", () => { globalThis.String(`${{ toString: () => fail() }}`); });
show("pass(Math.PI, `${{ toString: () => fail() }}`);", () => { pass(Math.PI, `${{ toString: () => fail() }}`); });
show("const a = Math.PI; pass(a, a); return `${{ toString: () => fail() }}`;", () => { const a = Math.PI; pass(a, a); return `${{ toString: () => fail() }}`; });
show("Array.isArray(`${{ toString: () => fail() }}`);", () => { Array.isArray(`${{ toString: () => fail() }}`); });
show("Number.isInteger(`${{ toString: () => fail() }}`);", () => { Number.isInteger(`${{ toString: () => fail() }}`); });
show("Object.keys(`${{ toString: () => fail() }}`);", () => { Object.keys(`${{ toString: () => fail() }}`); });
show("Reflect.ownKeys(`${{ toString: () => fail() }}`);", () => { Reflect.ownKeys(`${{ toString: () => fail() }}`); });
show("pass(undefined, `${{ toString: () => fail() }}`);", () => { pass(undefined, `${{ toString: () => fail() }}`); });
show("pass(Infinity, `${{ toString: () => fail() }}`);", () => { pass(Infinity, `${{ toString: () => fail() }}`); });
show("pass(Number, `${{ toString: () => fail() }}`);", () => { pass(Number, `${{ toString: () => fail() }}`); });
show("pass(Math, `${{ toString: () => fail() }}`);", () => { pass(Math, `${{ toString: () => fail() }}`); });
show("pass(Math.max, `${{ toString: () => fail() }}`);", () => { pass(Math.max, `${{ toString: () => fail() }}`); });
show("pass(Number.MAX_SAFE_INTEGER, `${{ toString: () => fail() }}`);", () => { pass(Number.MAX_SAFE_INTEGER, `${{ toString: () => fail() }}`); });
show("pass(globalThis, `${{ toString: () => fail() }}`);", () => { pass(globalThis, `${{ toString: () => fail() }}`); });
show("pass(Symbol.iterator, `${{ toString: () => fail() }}`);", () => { pass(Symbol.iterator, `${{ toString: () => fail() }}`); });
show("pass(JSON, `${{ toString: () => fail() }}`);", () => { pass(JSON, `${{ toString: () => fail() }}`); });
show("new Object(`${{ toString: () => fail() }}`);", () => { new Object(`${{ toString: () => fail() }}`); });
show("Object(`${{ toString: () => fail() }}`);", () => { Object(`${{ toString: () => fail() }}`); });
show("Array(`${{ toString: () => fail() }}`);", () => { Array(`${{ toString: () => fail() }}`); });
show("Boolean(`${{ toString: () => fail() }}`);", () => { Boolean(`${{ toString: () => fail() }}`); });
show("BigInt(`${{ toString: () => fail() }}`);", () => { BigInt(`${{ toString: () => fail() }}`); });
show("encodeURIComponent(`${{ toString: () => fail() }}`);", () => { encodeURIComponent(`${{ toString: () => fail() }}`); });
show("new Promise(`${{ toString: () => fail() }}`);", () => { new Promise(`${{ toString: () => fail() }}`); });
show("new Proxy(`${{ toString: () => fail() }}`, {});", () => { new Proxy(`${{ toString: () => fail() }}`, {}); });
show("Object.assign({}, `${{ toString: () => fail() }}`);", () => { Object.assign({}, `${{ toString: () => fail() }}`); });
show("Object.entries(`${{ toString: () => fail() }}`).map(pass);", () => { Object.entries(`${{ toString: () => fail() }}`).map(pass); });
show("Math.max(...[`${{ toString: () => fail() }}`]);", () => { Math.max(...[`${{ toString: () => fail() }}`]); });
show("Math.floor(pass(1)) + `${{ toString: () => fail() }}`;", () => { Math.floor(pass(1)) + `${{ toString: () => fail() }}`; });
show("[].concat(`${{ toString: () => fail() }}`);", () => { [].concat(`${{ toString: () => fail() }}`); });
show("\"a\".concat(`${{ toString: () => fail() }}`);", () => { "a".concat(`${{ toString: () => fail() }}`); });
show("\"a\".padStart(2, `${{ toString: () => fail() }}`);", () => { "a".padStart(2, `${{ toString: () => fail() }}`); });
show("[1].join(`${{ toString: () => fail() }}`);", () => { [1].join(`${{ toString: () => fail() }}`); });
show("[1].includes(`${{ toString: () => fail() }}`);", () => { [1].includes(`${{ toString: () => fail() }}`); });
show("holder.arr.push(`${{ toString: () => fail() }}`);", () => { holder.arr.push(`${{ toString: () => fail() }}`); });
show("holder.arr.indexOf(`${{ toString: () => fail() }}`);", () => { holder.arr.indexOf(`${{ toString: () => fail() }}`); });
show("holder.s.startsWith(`${{ toString: () => fail() }}`);", () => { holder.s.startsWith(`${{ toString: () => fail() }}`); });
show("const a = `${{ toString: () => fail() }}`; pass(() => a);", () => { const a = `${{ toString: () => fail() }}`; pass(() => a); });
show("let a = `${{ toString: () => fail() }}`; pass(() => a);", () => { let a = `${{ toString: () => fail() }}`; pass(() => a); });
show("let a; a = `${{ toString: () => fail() }}`; pass(() => a);", () => { let a; a = `${{ toString: () => fail() }}`; pass(() => a); });
show("key = `${{ toString: () => fail() }}`;", () => { key = `${{ toString: () => fail() }}`; });
show("const a = `${{ toString: () => fail() }}`; pass(a, a);", () => { const a = `${{ toString: () => fail() }}`; pass(a, a); });
show("var a = `${{ toString: () => fail() }}`; pass(() => a);", () => { var a = `${{ toString: () => fail() }}`; pass(() => a); });
show("const a = 1 + `${{ toString: () => fail() }}`.length; pass(() => a);", () => { const a = 1 + `${{ toString: () => fail() }}`.length; pass(() => a); });
show("let a = 1; a += `${{ toString: () => fail() }}`; pass(() => a);", () => { let a = 1; a += `${{ toString: () => fail() }}`; pass(() => a); });
show("key += `${{ toString: () => fail() }}`;", () => { key += `${{ toString: () => fail() }}`; });
show("key ||= `${{ toString: () => fail() }}`;", () => { key ||= `${{ toString: () => fail() }}`; });
show("key &&= `${{ toString: () => fail() }}`;", () => { key &&= `${{ toString: () => fail() }}`; });
show("key ??= `${{ toString: () => fail() }}`;", () => { key ??= `${{ toString: () => fail() }}`; });
show("let a = 0; pass(() => a); a ||= `${{ toString: () => fail() }}`;", () => { let a = 0; pass(() => a); a ||= `${{ toString: () => fail() }}`; });
show("let a = 0; pass(() => a); a++; return `${{ toString: () => fail() }}`;", () => { let a = 0; pass(() => a); a++; return `${{ toString: () => fail() }}`; });
show("let a = 0; pass(() => a); ++a; return `${{ toString: () => fail() }}`;", () => { let a = 0; pass(() => a); ++a; return `${{ toString: () => fail() }}`; });
show("++key; return `${{ toString: () => fail() }}`;", () => { ++key; return `${{ toString: () => fail() }}`; });
show("key--; return `${{ toString: () => fail() }}`;", () => { key--; return `${{ toString: () => fail() }}`; });
show("pass(key++); return `${{ toString: () => fail() }}`;", () => { pass(key++); return `${{ toString: () => fail() }}`; });
show("let a = pass(1), b = `${{ toString: () => fail() }}`; pass(() => a + b);", () => { let a = pass(1), b = `${{ toString: () => fail() }}`; pass(() => a + b); });
show("const a = pass(1); const b = `${{ toString: () => fail() }}`; pass(() => a + b);", () => { const a = pass(1); const b = `${{ toString: () => fail() }}`; pass(() => a + b); });
show("const a = () => `${{ toString: () => fail() }}`; a(); a();", () => { const a = () => `${{ toString: () => fail() }}`; a(); a(); });
show("const a = function () { return `${{ toString: () => fail() }}`; }; a(); a();", () => { const a = function () { return `${{ toString: () => fail() }}`; }; a(); a(); });
show("const [a] = [`${{ toString: () => fail() }}`]; pass(() => a);", () => { const [a] = [`${{ toString: () => fail() }}`]; pass(() => a); });
show("const { a } = { a: `${{ toString: () => fail() }}` }; pass(() => a);", () => { const { a } = { a: `${{ toString: () => fail() }}` }; pass(() => a); });
show("const { a = `${{ toString: () => fail() }}` } = {}; pass(() => a);", () => { const { a = `${{ toString: () => fail() }}` } = {}; pass(() => a); });
show("for (const a = `${{ toString: () => fail() }}`; ; ) { pass(() => a); }", () => { for (const a = `${{ toString: () => fail() }}`; ; ) { pass(() => a); } });
show("for (let a = `${{ toString: () => fail() }}`; ; ) { pass(() => a); }", () => { for (let a = `${{ toString: () => fail() }}`; ; ) { pass(() => a); } });
show("class A { static x = `${{ toString: () => fail() }}`; }", () => { class A { static x = `${{ toString: () => fail() }}`; } });
show("class A { x = `${{ toString: () => fail() }}`; } new A();", () => { class A { x = `${{ toString: () => fail() }}`; } new A(); });
show("function g(a = `${{ toString: () => fail() }}`) { pass(() => a); } g(); g();", () => { function g(a = `${{ toString: () => fail() }}`) { pass(() => a); } g(); g(); });
show("const a = five ? `${{ toString: () => fail() }}` : 1; pass(() => a);", () => { const a = five ? `${{ toString: () => fail() }}` : 1; pass(() => a); });
show("const a = pass(`${{ toString: () => fail() }}`); pass(() => a);", () => { const a = pass(`${{ toString: () => fail() }}`); pass(() => a); });
show("const a = [`${{ toString: () => fail() }}`]; pass(() => a);", () => { const a = [`${{ toString: () => fail() }}`]; pass(() => a); });
show("const a = { b: `${{ toString: () => fail() }}` }; pass(() => a);", () => { const a = { b: `${{ toString: () => fail() }}` }; pass(() => a); });
show("const a = -`${{ toString: () => fail() }}`; pass(() => a);", () => { const a = -`${{ toString: () => fail() }}`; pass(() => a); });
show("const a = `${{ toString: () => fail() }}` + 1; pass(() => a);", () => { const a = `${{ toString: () => fail() }}` + 1; pass(() => a); });
show("const a = 1 + `${{ toString: () => fail() }}`; pass(() => a);", () => { const a = 1 + `${{ toString: () => fail() }}`; pass(() => a); });
show("class A { } return `${{ toString: () => fail() }}`;", () => { class A { } return `${{ toString: () => fail() }}`; });
show("class A { m() { } nothing() { } } return `${{ toString: () => fail() }}`;", () => { class A { m() { } nothing() { } } return `${{ toString: () => fail() }}`; });
show("class A { static m() { } } return `${{ toString: () => fail() }}`;", () => { class A { static m() { } } return `${{ toString: () => fail() }}`; });
show("class A { get x() { return 1; } } return `${{ toString: () => fail() }}`;", () => { class A { get x() { return 1; } } return `${{ toString: () => fail() }}`; });
show("class A { set x(v) { } } return `${{ toString: () => fail() }}`;", () => { class A { set x(v) { } } return `${{ toString: () => fail() }}`; });
show("class A { x = 1; } return `${{ toString: () => fail() }}`;", () => { class A { x = 1; } return `${{ toString: () => fail() }}`; });
show("class A { static x = 1; } return `${{ toString: () => fail() }}`;", () => { class A { static x = 1; } return `${{ toString: () => fail() }}`; });
show("class A { constructor() { } } return `${{ toString: () => fail() }}`;", () => { class A { constructor() { } } return `${{ toString: () => fail() }}`; });
show("class A { constructor() { } m() { } } return `${{ toString: () => fail() }}`;", () => { class A { constructor() { } m() { } } return `${{ toString: () => fail() }}`; });
show("class A { m() { } constructor() { } } return `${{ toString: () => fail() }}`;", () => { class A { m() { } constructor() { } } return `${{ toString: () => fail() }}`; });
show("class A { m() { } static x = pass(1); } return `${{ toString: () => fail() }}`;", () => { class A { m() { } static x = pass(1); } return `${{ toString: () => fail() }}`; });
show("class A { static x = pass(1); m() { } } return `${{ toString: () => fail() }}`;", () => { class A { static x = pass(1); m() { } } return `${{ toString: () => fail() }}`; });
show("class A { #p() { } } return `${{ toString: () => fail() }}`;", () => { class A { #p() { } } return `${{ toString: () => fail() }}`; });
show("class A { #p = 1; } return `${{ toString: () => fail() }}`;", () => { class A { #p = 1; } return `${{ toString: () => fail() }}`; });
show("class A { \"m\"() { } } return `${{ toString: () => fail() }}`;", () => { class A { "m"() { } } return `${{ toString: () => fail() }}`; });
show("class A { 1() { } } return `${{ toString: () => fail() }}`;", () => { class A { 1() { } } return `${{ toString: () => fail() }}`; });
show("class A { [key]() { } } return `${{ toString: () => fail() }}`;", () => { class A { [key]() { } } return `${{ toString: () => fail() }}`; });
show("class A { [\"m\"]() { } } return `${{ toString: () => fail() }}`;", () => { class A { ["m"]() { } } return `${{ toString: () => fail() }}`; });
show("class A { *m() { } } return `${{ toString: () => fail() }}`;", () => { class A { *m() { } } return `${{ toString: () => fail() }}`; });
show("class A { async m() { } } return `${{ toString: () => fail() }}`;", () => { class A { async m() { } } return `${{ toString: () => fail() }}`; });
show("class A extends Object { } return `${{ toString: () => fail() }}`;", () => { class A extends Object { } return `${{ toString: () => fail() }}`; });
show("class A extends Object { m() { } } return `${{ toString: () => fail() }}`;", () => { class A extends Object { m() { } } return `${{ toString: () => fail() }}`; });
show("class A extends Thrower { m() { } } return `${{ toString: () => fail() }}`;", () => { class A extends Thrower { m() { } } return `${{ toString: () => fail() }}`; });
show("class A extends null { } return `${{ toString: () => fail() }}`;", () => { class A extends null { } return `${{ toString: () => fail() }}`; });
show("class A { m() { } static { } } return `${{ toString: () => fail() }}`;", () => { class A { m() { } static { } } return `${{ toString: () => fail() }}`; });
show("class A { static { pass(1); } m() { } } return `${{ toString: () => fail() }}`;", () => { class A { static { pass(1); } m() { } } return `${{ toString: () => fail() }}`; });
show("let A; A = class { m() { } }; return `${{ toString: () => fail() }}`;", () => { let A; A = class { m() { } }; return `${{ toString: () => fail() }}`; });
show("let A; A = class B { m() { } }; return `${{ toString: () => fail() }}`;", () => { let A; A = class B { m() { } }; return `${{ toString: () => fail() }}`; });
show("let each; each = { m() { } }; return `${{ toString: () => fail() }}`;", () => { let each; each = { m() { } }; return `${{ toString: () => fail() }}`; });
show("let each; each = { get x() { return 1; } }; return `${{ toString: () => fail() }}`;", () => { let each; each = { get x() { return 1; } }; return `${{ toString: () => fail() }}`; });
show("let each; each = { m: function () { } }; return `${{ toString: () => fail() }}`;", () => { let each; each = { m: function () { } }; return `${{ toString: () => fail() }}`; });
show("let each; each = { m: () => 1 }; return `${{ toString: () => fail() }}`;", () => { let each; each = { m: () => 1 }; return `${{ toString: () => fail() }}`; });
show("let each; each = { [key]: 1 }; return `${{ toString: () => fail() }}`;", () => { let each; each = { [key]: 1 }; return `${{ toString: () => fail() }}`; });
show("let each; each = { [key]() { } }; return `${{ toString: () => fail() }}`;", () => { let each; each = { [key]() { } }; return `${{ toString: () => fail() }}`; });
show("let each; each = { a: 1, ...o }; return `${{ toString: () => fail() }}`;", () => { let each; each = { a: 1, ...o }; return `${{ toString: () => fail() }}`; });
show("let each; each = [1, , 2]; return `${{ toString: () => fail() }}`;", () => { let each; each = [1, , 2]; return `${{ toString: () => fail() }}`; });
show("let each; each = /a/; return `${{ toString: () => fail() }}`;", () => { let each; each = /a/; return `${{ toString: () => fail() }}`; });
show("let each; each = function () { }; return `${{ toString: () => fail() }}`;", () => { let each; each = function () { }; return `${{ toString: () => fail() }}`; });
show("let each; each = () => 1; return `${{ toString: () => fail() }}`;", () => { let each; each = () => 1; return `${{ toString: () => fail() }}`; });
show("let each; each = function* () { }; return `${{ toString: () => fail() }}`;", () => { let each; each = function* () { }; return `${{ toString: () => fail() }}`; });
show("let each; each = async () => 1; return `${{ toString: () => fail() }}`;", () => { let each; each = async () => 1; return `${{ toString: () => fail() }}`; });
show("(function () { const c = 57; fail(); return (c ? pass(1) : pass(2)); })();", () => { (function () { const c = 57; fail(); return (c ? pass(1) : pass(2)); })(); });
show("(function () { const c = 0; fail(); return (c ? pass(1) : pass(2)); })();", () => { (function () { const c = 0; fail(); return (c ? pass(1) : pass(2)); })(); });
show("(function () { const c = \"\"; fail(); return c ? pass(1) : pass(2); })();", () => { (function () { const c = ""; fail(); return c ? pass(1) : pass(2); })(); });
show("(function () { const c = 57; fail(); return c && pass(1); })();", () => { (function () { const c = 57; fail(); return c && pass(1); })(); });
show("(function () { const c = 0; fail(); return c || pass(1); })();", () => { (function () { const c = 0; fail(); return c || pass(1); })(); });
show("(function () { const c = null; fail(); return c ?? pass(1); })();", () => { (function () { const c = null; fail(); return c ?? pass(1); })(); });
show("(function () { const c = 57; fail(); if (c) { pass(1); } else { pass(2); } })();", () => { (function () { const c = 57; fail(); if (c) { pass(1); } else { pass(2); } })(); });
show("(function () { const c = 60; fail(); return c; })();", () => { (function () { const c = 60; fail(); return c; })(); });
show("(function () { const c = \"text\"; fail(); return c; })();", () => { (function () { const c = "text"; fail(); return c; })(); });
show("(function () { const c = true; fail(); return c; })();", () => { (function () { const c = true; fail(); return c; })(); });
show("(function () { const c = 60; fail(); return c + 1; })();", () => { (function () { const c = 60; fail(); return c + 1; })(); });
show("(function () { const c = 60; fail(); return 1 + c; })();", () => { (function () { const c = 60; fail(); return 1 + c; })(); });
show("(function () { const c = 60; fail(); return five + c; })();", () => { (function () { const c = 60; fail(); return five + c; })(); });
show("(function () { const c = 60; fail(); return [c]; })();", () => { (function () { const c = 60; fail(); return [c]; })(); });
show("(function () { const c = 60; fail(); return pass(c); })();", () => { (function () { const c = 60; fail(); return pass(c); })(); });
show("(function () { const c = 60; fail(); return -c; })();", () => { (function () { const c = 60; fail(); return -c; })(); });
show("(function () { const c = 60; fail(); pass(c); return c; })();", () => { (function () { const c = 60; fail(); pass(c); return c; })(); });
show("(function () { const c = 30 + 30; fail(); pass(c); return c; })();", () => { (function () { const c = 30 + 30; fail(); pass(c); return c; })(); });
show("(function () { const c = -60; fail(); pass(c); return c; })();", () => { (function () { const c = -60; fail(); pass(c); return c; })(); });
show("(function () { const c = \"a\" + \"b\"; fail(); pass(c); return c; })();", () => { (function () { const c = "a" + "b"; fail(); pass(c); return c; })(); });
show("(function () { const c = `a`; fail(); pass(c); return c; })();", () => { (function () { const c = `a`; fail(); pass(c); return c; })(); });
show("(function () { const c = !0; fail(); pass(c); return c; })();", () => { (function () { const c = !0; fail(); pass(c); return c; })(); });
show("(function () { const c = \"ab\".length; fail(); pass(c); return c; })();", () => { (function () { const c = "ab".length; fail(); pass(c); return c; })(); });
show("(function () { const c = 60, d = c; fail(); pass(d); return d; })();", () => { (function () { const c = 60, d = c; fail(); pass(d); return d; })(); });
show("(function () { const c = 60n; fail(); pass(c); return c; })();", () => { (function () { const c = 60n; fail(); pass(c); return c; })(); });
show("(function () { let c = 60; fail(); pass(c); return c; })();", () => { (function () { let c = 60; fail(); pass(c); return c; })(); });
show("(function () { pass(1); const c = 60; fail(); pass(c); return c; })();", () => { (function () { pass(1); const c = 60; fail(); pass(c); return c; })(); });
show("const c = 60; nothing[c];", () => { const c = 60; nothing[c]; });
show("const c = 60; nothing[c]();", () => { const c = 60; nothing[c](); });
show("const c = \"x\"; nothing[c];", () => { const c = "x"; nothing[c]; });
show("const c = 60; c();", () => { const c = 60; c(); });
show("const c = 60; c.x.y;", () => { const c = 60; c.x.y; });
show("const c = 60; pass(c)();", () => { const c = 60; pass(c)(); });
show("const c = 60; c in nothing;", () => { const c = 60; c in nothing; });
show("const c = 60; nothing instanceof c;", () => { const c = 60; nothing instanceof c; });
show("const c = 60; new c();", () => { const c = 60; new c(); });
show("const c = 60; [...c];", () => { const c = 60; [...c]; });
show("const c = 60; c + symbol;", () => { const c = 60; c + symbol; });
show("const c = 60; symbol + c;", () => { const c = 60; symbol + c; });
show("const c = 60; `${c}${symbol}`;", () => { const c = 60; `${c}${symbol}`; });
show("const c = 60; for (const a of c) pass(a);", () => { const c = 60; for (const a of c) pass(a); });
show("const c = 60; const { x } = nothing[c];", () => { const c = 60; const { x } = nothing[c]; });
show("pass({ a: 1, ...{ b: pass(1) }, c: `${{ toString: () => fail() }}` });", () => { pass({ a: 1, ...{ b: pass(1) }, c: `${{ toString: () => fail() }}` }); });
show("pass({ ...{ b: pass(1) }, c: `${{ toString: () => fail() }}` });", () => { pass({ ...{ b: pass(1) }, c: `${{ toString: () => fail() }}` }); });
show("pass({ a: 1, ...o.nested, c: `${{ toString: () => fail() }}` });", () => { pass({ a: 1, ...o.nested, c: `${{ toString: () => fail() }}` }); });
show("pass({ a: 1, ...id(holder), c: `${{ toString: () => fail() }}` });", () => { pass({ a: 1, ...id(holder), c: `${{ toString: () => fail() }}` }); });
show("pass({ a: 1, ...o, c: `${{ toString: () => fail() }}` });", () => { pass({ a: 1, ...o, c: `${{ toString: () => fail() }}` }); });
show("pass({ ...o, c: `${{ toString: () => fail() }}` });", () => { pass({ ...o, c: `${{ toString: () => fail() }}` }); });
show("pass({ ...o, ...o.nested, c: `${{ toString: () => fail() }}` });", () => { pass({ ...o, ...o.nested, c: `${{ toString: () => fail() }}` }); });
show("pass({ a: pass(1), ...(five ? holder : nothing), c: `${{ toString: () => fail() }}` });", () => { pass({ a: pass(1), ...(five ? holder : nothing), c: `${{ toString: () => fail() }}` }); });
show("pass({ a: pass(1), ...(five && holder), c: `${{ toString: () => fail() }}` });", () => { pass({ a: pass(1), ...(five && holder), c: `${{ toString: () => fail() }}` }); });
show("pass({ a: 1, ...[1], c: `${{ toString: () => fail() }}` });", () => { pass({ a: 1, ...[1], c: `${{ toString: () => fail() }}` }); });
show("pass({ a: 1, ...null, c: `${{ toString: () => fail() }}` });", () => { pass({ a: 1, ...null, c: `${{ toString: () => fail() }}` }); });
show("pass({ a: 1, ...{ get b() { return fail(); } } });", () => { pass({ a: 1, ...{ get b() { return fail(); } } }); });
show("pass({ ...{ get b() { return fail(); } } });", () => { pass({ ...{ get b() { return fail(); } } }); });
show("pass({ a: 1, ...new Proxy({}, { ownKeys: fail }) });", () => { pass({ a: 1, ...new Proxy({}, { ownKeys: fail }) }); });
show("pass({ a: 1, ...id({ get b() { return fail(); } }) });", () => { pass({ a: 1, ...id({ get b() { return fail(); } }) }); });
show("const each = { get b() { return fail(); } }; pass(each, { a: 1, ...q });", () => { const each = { get b() { return fail(); } }; pass(each, { a: 1, ...q }); });
show("const each = { get b() { return fail(); } }; pass(each, { ...q });", () => { const each = { get b() { return fail(); } }; pass(each, { ...q }); });
show("const each = { get b() { return fail(); } }; pass(each, { a: 1, ...q, c: 2 });", () => { const each = { get b() { return fail(); } }; pass(each, { a: 1, ...q, c: 2 }); });
await showAsync("await pass(1); return `${{ toString: () => fail() }}`;", async () => { await pass(1); return `${{ toString: () => fail() }}`; });
await showAsync("for await (const a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`;", async () => { for await (const a of holder.arr) { pass(a); } return `${{ toString: () => fail() }}`; });
await showAsync("for await (const a of holder.arr) { } return `${{ toString: () => fail() }}`;", async () => { for await (const a of holder.arr) { } return `${{ toString: () => fail() }}`; });
await showAsync("const a = await pass(1); pass(a, a); return `${{ toString: () => fail() }}`;", async () => { const a = await pass(1); pass(a, a); return `${{ toString: () => fail() }}`; });
await showAsync("await Promise.all([pass(1)]); return `${{ toString: () => fail() }}`;", async () => { await Promise.all([pass(1)]); return `${{ toString: () => fail() }}`; });
await showAsync("try { await pass(1); } catch (e) { pass(2); } return `${{ toString: () => fail() }}`;", async () => { try { await pass(1); } catch (e) { pass(2); } return `${{ toString: () => fail() }}`; });
await showAsync("try { await pass(1); } finally { pass(2); } return `${{ toString: () => fail() }}`;", async () => { try { await pass(1); } finally { pass(2); } return `${{ toString: () => fail() }}`; });
await showAsync("if (await pass(1)) { pass(2); } return `${{ toString: () => fail() }}`;", async () => { if (await pass(1)) { pass(2); } return `${{ toString: () => fail() }}`; });
await showAsync("for (const a of holder.arr) { await pass(a); } return `${{ toString: () => fail() }}`;", async () => { for (const a of holder.arr) { await pass(a); } return `${{ toString: () => fail() }}`; });

// GENERATED: fail placesOf Made nothing B each
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Error" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="fail"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Error"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: Throw v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="placesOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}] results=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = PropGet v0 key="stack"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="split"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="\n"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="split" calleeName="split"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="filter"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v12 = NewClosure function=[[f_5]]
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="filter" calleeName="filter"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="map"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v17 = NewClosure function=[[f_7]]
// CHECK-NEXT: v18 = Call v16, v14, v17 calleeKey="map" calleeName="map"
// CHECK-NEXT: ReturnCall v18 casts=[{declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="Made"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nothing"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee] thisType={type=anything} results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number|object flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
