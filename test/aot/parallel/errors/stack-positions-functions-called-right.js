// Prints where a stack trace places the callers of function expressions that are called in many ways where they are written, and what `in`, `instanceof` and a spread refuse.
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
const inThisFile = /stack-positions-functions-called-right/;
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
function F() {}
show("!function () { fail(); if (five) { pass(1); } }();", () => { !function () { fail(); if (five) { pass(1); } }(); });
show("void function () { fail(); if (five) { pass(1); } }();", () => { void function () { fail(); if (five) { pass(1); } }(); });
show("+function () { fail(); if (five) { pass(1); } }();", () => { +function () { fail(); if (five) { pass(1); } }(); });
show("(function () { fail(); if (five) { pass(1); } }());", () => { (function () { fail(); if (five) { pass(1); } }()); });
show("(function () { fail(); if (five) { pass(1); } }).call(this);", () => { (function () { fail(); if (five) { pass(1); } }).call(this); });
show("(function () { fail(); if (five) { pass(1); } }).apply(this, []);", () => { (function () { fail(); if (five) { pass(1); } }).apply(this, []); });
show("(function () { fail(); if (five) { pass(1); } }).bind(this)();", () => { (function () { fail(); if (five) { pass(1); } }).bind(this)(); });
show("(() => { fail(); if (five) { pass(1); } })?.();", () => { (() => { fail(); if (five) { pass(1); } })?.(); });
show("new function () { fail(); if (five) { pass(1); } };", () => { new function () { fail(); if (five) { pass(1); } }; });
show("new function () { fail(); if (five) { pass(1); } }();", () => { new function () { fail(); if (five) { pass(1); } }(); });
show("new (function () { fail(); if (five) { pass(1); } });", () => { new (function () { fail(); if (five) { pass(1); } }); });
show("(function (root, factory) { factory(); if (five) { pass(1); } })(this, function () { fail(); if (five) { pass(1); } });", () => { (function (root, factory) { factory(); if (five) { pass(1); } })(this, function () { fail(); if (five) { pass(1); } }); });
show("(function (root, factory) { root.x = factory(); })(holder, function () { fail(); while (five) {} });", () => { (function (root, factory) { root.x = factory(); })(holder, function () { fail(); while (five) {} }); });
show("pass(function () { if (five) { pass(1); } }, fail());", () => { pass(function () { if (five) { pass(1); } }, fail()); });
show("pass(function () { if (five) { pass(1); } }).x.y;", () => { pass(function () { if (five) { pass(1); } }).x.y; });
show("pass(() => { if (five) { pass(1); } })(fail());", () => { pass(() => { if (five) { pass(1); } })(fail()); });
show("const r = (function () { fail(); if (five) { pass(1); } })(); pass(r, r);", () => { const r = (function () { fail(); if (five) { pass(1); } })(); pass(r, r); });
show("return (function () { fail(); if (five) { pass(1); } })();", () => { return (function () { fail(); if (five) { pass(1); } })(); });
show("return (() => { fail(); for (;;) {} })();", () => { return (() => { fail(); for (;;) {} })(); });
show("pass((function () { fail(); if (five) { pass(1); } })());", () => { pass((function () { fail(); if (five) { pass(1); } })()); });
show("[(function () { fail(); if (five) { pass(1); } })()];", () => { [(function () { fail(); if (five) { pass(1); } })()]; });
show("({ a: (function () { fail(); if (five) { pass(1); } })() });", () => { ({ a: (function () { fail(); if (five) { pass(1); } })() }); });
show("(function () { fail(); if (five) { pass(1); } })().x;", () => { (function () { fail(); if (five) { pass(1); } })().x; });
show("(function () { return fail; if (five) { pass(1); } })()();", () => { (function () { return fail; if (five) { pass(1); } })()(); });
show("(function () { return function () { fail(); if (five) { pass(1); } }; })()();", () => { (function () { return function () { fail(); if (five) { pass(1); } }; })()(); });
show("(function outer() { (function inner() { fail(); if (five) { pass(1); } })(); if (five) { pass(2); } })();", () => { (function outer() { (function inner() { fail(); if (five) { pass(1); } })(); if (five) { pass(2); } })(); });
show("(function () { fail(); if (five) { pass(1); } } )();", () => { (function () { fail(); if (five) { pass(1); } } )(); });
show("(function () { fail(); if (five) { pass(1); } } /* c */)();", () => { (function () { fail(); if (five) { pass(1); } } /* c */)(); });
show("((function () { fail(); if (five) { pass(1); } }))();", () => { ((function () { fail(); if (five) { pass(1); } }))(); });
show("(0, function () { fail(); if (five) { pass(1); } })();", () => { (0, function () { fail(); if (five) { pass(1); } })(); });
show("(five ? function () { fail(); if (five) { pass(1); } } : pass)();", () => { (five ? function () { fail(); if (five) { pass(1); } } : pass)(); });
show("(five && function () { fail(); if (five) { pass(1); } })();", () => { (five && function () { fail(); if (five) { pass(1); } })(); });
show("(nothing ?? function () { fail(); if (five) { pass(1); } })();", () => { (nothing ?? function () { fail(); if (five) { pass(1); } })(); });
show("(nothing || (() => { fail(); if (five) { pass(1); } }))();", () => { (nothing || (() => { fail(); if (five) { pass(1); } }))(); });
show("(holder.zz = function () { fail(); if (five) { pass(1); } })();", () => { (holder.zz = function () { fail(); if (five) { pass(1); } })(); });
show("({ m() { fail(); if (five) { pass(1); } } }).m();", () => { ({ m() { fail(); if (five) { pass(1); } } }).m(); });
show("({ m: function () { fail(); if (five) { pass(1); } } }).m();", () => { ({ m: function () { fail(); if (five) { pass(1); } } }).m(); });
show("[function () { fail(); if (five) { pass(1); } }][0]();", () => { [function () { fail(); if (five) { pass(1); } }][0](); });
show("(class { static m() { fail(); if (five) { pass(1); } } }).m();", () => { (class { static m() { fail(); if (five) { pass(1); } } }).m(); });
show("(function* () { fail(); if (five) { pass(1); } })().next();", () => { (function* () { fail(); if (five) { pass(1); } })().next(); });
show("[...(function* () { fail(); if (five) { pass(1); } })()];", () => { [...(function* () { fail(); if (five) { pass(1); } })()]; });
show("for (const each of (function* () { fail(); if (five) { pass(1); } })()) {}", () => { for (const each of (function* () { fail(); if (five) { pass(1); } })()) {} });
show("`${(function () { fail(); if (five) { pass(1); } })()}`;", () => { `${(function () { fail(); if (five) { pass(1); } })()}`; });
show("(function () { fail(); if (five) { pass(1); } })() + 1;", () => { (function () { fail(); if (five) { pass(1); } })() + 1; });
show("1 + (function () { fail(); if (five) { pass(1); } })();", () => { 1 + (function () { fail(); if (five) { pass(1); } })(); });
show("typeof (function () { fail(); if (five) { pass(1); } })();", () => { typeof (function () { fail(); if (five) { pass(1); } })(); });
show("if ((function () { fail(); if (five) { pass(1); } })()) {}", () => { if ((function () { fail(); if (five) { pass(1); } })()) {} });
show("throw (function () { fail(); if (five) { pass(1); } })();", () => { throw (function () { fail(); if (five) { pass(1); } })(); });
show("[...(pass)(nothing)];", () => { [...(pass)(nothing)]; });
show("[...(holder.a)];", () => { [...(holder.a)]; });
show("[...(1, nothing)];", () => { [...(1, nothing)]; });
show("[...(nothing)];", () => { [...(nothing)]; });
show("[...(holder).a];", () => { [...(holder).a]; });
show("[...(five ? nothing : missing)];", () => { [...(five ? nothing : missing)]; });
show("[...n ?? missing];", () => { [...n ?? missing]; });
show("[...(holder.a).b];", () => { [...(holder.a).b]; });
show("[...new (F)()];", () => { [...new (F)()]; });
show("[...-five];", () => { [...-five]; });
show("[...typeof five === \"x\" ? nothing : missing];", () => { [...typeof five === "x" ? nothing : missing]; });
show("[...`a${five}`.x];", () => { [...`a${five}`.x]; });
show("[1, ...(pass)(nothing), 2];", () => { [1, ...(pass)(nothing), 2]; });
show("1 in (pass)(five);", () => { 1 in (pass)(five); });
show("1 in (holder).f;", () => { 1 in (holder).f; });
show("holder instanceof (pass)(five);", () => { holder instanceof (pass)(five); });
show("holder instanceof (holder).f;", () => { holder instanceof (holder).f; });
show("1 in (1, five);", () => { 1 in (1, five); });
show("1 in five.x;", () => { 1 in five.x; });
show("1 in -five;", () => { 1 in -five; });
show("1 in (five ? five : nothing);", () => { 1 in (five ? five : nothing); });
show("holder instanceof (1, five);", () => { holder instanceof (1, five); });
show("holder instanceof five.x;", () => { holder instanceof five.x; });
show("holder instanceof (five ? five : nothing);", () => { holder instanceof (five ? five : nothing); });
show("holder instanceof `a`;", () => { holder instanceof `a`; });
show("key in (holder.a);", () => { key in (holder.a); });
show("key in holder.a;", () => { key in holder.a; });
show("key in pass(five);", () => { key in pass(five); });
show("key in new Made;", () => { key in new Made; });
show("holder instanceof holder.f;", () => { holder instanceof holder.f; });
show("holder instanceof pass(five);", () => { holder instanceof pass(five); });
show("pass(1 in five);", () => { pass(1 in five); });
show("pass(holder instanceof five);", () => { pass(holder instanceof five); });
show("let a; 1 in (a = five);", () => { let a; 1 in (a = five); });
show("let a; holder instanceof (a = five);", () => { let a; holder instanceof (a = five); });
show("1 in (1 ? five : nothing);", () => { 1 in (1 ? five : nothing); });
show("key in (five ? five : nothing);", () => { key in (five ? five : nothing); });
show("pass(1) in (five ? five : nothing);", () => { pass(1) in (five ? five : nothing); });
show("holder.s in (five ? five : nothing);", () => { holder.s in (five ? five : nothing); });
show("[...(1 ? nothing : missing)];", () => { [...(1 ? nothing : missing)]; });
show("(1 ? nothing : missing).x;", () => { (1 ? nothing : missing).x; });
show("(1 ? nothing : missing)();", () => { (1 ? nothing : missing)(); });
await showAsync("await (async function main() { fail(); if (five) { pass(1); } })().catch(e => { throw e; });", async () => { await (async function main() { fail(); if (five) { pass(1); } })().catch(e => { throw e; }); });
await showAsync("await (async () => { await 1; fail(); if (five) { pass(1); } })().catch(e => { throw e; });", async () => { await (async () => { await 1; fail(); if (five) { pass(1); } })().catch(e => { throw e; }); });
await showAsync("await (async () => { fail(); if (five) { pass(1); } })().then(pass);", async () => { await (async () => { fail(); if (five) { pass(1); } })().then(pass); });
await showAsync("await (async () => { fail(); if (five) { pass(1); } })().finally(pass);", async () => { await (async () => { fail(); if (five) { pass(1); } })().finally(pass); });
await showAsync("(async () => { if (five) { pass(1); } })().x.y;", async () => { (async () => { if (five) { pass(1); } })().x.y; });
await showAsync("await Promise.all([(async () => { fail(); if (five) { pass(1); } })()]);", async () => { await Promise.all([(async () => { fail(); if (five) { pass(1); } })()]); });
await showAsync("for await (const each of (async function* () { fail(); if (five) { pass(1); } })()) {}", async () => { for await (const each of (async function* () { fail(); if (five) { pass(1); } })()) {} });
await showAsync("await new Promise((resolve, reject) => { fail(); if (five) { pass(1); } });", async () => { await new Promise((resolve, reject) => { fail(); if (five) { pass(1); } }); });
await showAsync("await new Promise((resolve, reject) => { setTimeout(() => { try { fail(); } catch (e) { reject(e); } if (five) { pass(1); } }, 1); });", async () => { await new Promise((resolve, reject) => { setTimeout(() => { try { fail(); } catch (e) { reject(e); } if (five) { pass(1); } }, 1); }); });
await showAsync("await (async () => { try { await (async () => { await 1; fail(); })(); } finally { pass(1); } })();", async () => { await (async () => { try { await (async () => { await 1; fail(); })(); } finally { pass(1); } })(); });
