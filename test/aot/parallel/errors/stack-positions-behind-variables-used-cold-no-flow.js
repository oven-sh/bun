// Prints where a stack trace places what throws in an expression that holds the only use of a variable, which is declared in the statement in front of it.
// Flags: --aot-heat=everything-is-cold --aot-disable=flow-results
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
const inThisFile = /stack-positions-behind-variables-that-are-used-once/;
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
show("pass({ valueOf: fail } + 1);", () => { pass({ valueOf: fail } + 1); });
show("let once = { valueOf: fail }; pass(once + 1);", () => { let once = { valueOf: fail }; pass(once + 1); });
show("pass(1 + { valueOf: fail });", () => { pass(1 + { valueOf: fail }); });
show("let once = { valueOf: fail }; pass(1 + once);", () => { let once = { valueOf: fail }; pass(1 + once); });
show("pass({ valueOf: fail } == 1);", () => { pass({ valueOf: fail } == 1); });
show("let once = { valueOf: fail }; pass(once == 1);", () => { let once = { valueOf: fail }; pass(once == 1); });
show("pass(`${{ toString: fail }}`);", () => { pass(`${{ toString: fail }}`); });
show("let once = { toString: fail }; pass(`${once}`);", () => { let once = { toString: fail }; pass(`${once}`); });
show("pass(-{ valueOf: fail });", () => { pass(-{ valueOf: fail }); });
show("let once = { valueOf: fail }; pass(-once);", () => { let once = { valueOf: fail }; pass(-once); });
show("pass(holder[{ toString: fail }]);", () => { pass(holder[{ toString: fail }]); });
show("let once = { toString: fail }; pass(holder[once]);", () => { let once = { toString: fail }; pass(holder[once]); });
show("let once = { valueOf: fail }; return once + 1;", () => { let once = { valueOf: fail }; return once + 1; });
show("let once = { valueOf: fail }; return once * 2;", () => { let once = { valueOf: fail }; return once * 2; });
show("let once = { valueOf: fail }; return five * once;", () => { let once = { valueOf: fail }; return five * once; });
show("let once = { valueOf: fail }; const next = once + 1; return next;", () => { let once = { valueOf: fail }; const next = once + 1; return next; });
show("let once = holder.nested; return once.deep.x;", () => { let once = holder.nested; return once.deep.x; });
show("let once = holder.nested.deep; return once.x;", () => { let once = holder.nested.deep; return once.x; });
show("let once = holder.g(); return once.h.i.j;", () => { let once = holder.g(); return once.h.i.j; });
show("let once = pass(nothing); return once.x;", () => { let once = pass(nothing); return once.x; });
show("let once = pass(nothing); once.x();", () => { let once = pass(nothing); once.x(); });
show("let once = pass(nothing); once();", () => { let once = pass(nothing); once(); });
show("let once = pass(nothing); new once();", () => { let once = pass(nothing); new once(); });
show("let once = pass(nothing); for (const each of once) {}", () => { let once = pass(nothing); for (const each of once) {} });
show("let once = pass(nothing); const { a } = once;", () => { let once = pass(nothing); const { a } = once; });
show("let once = pass(nothing); const [a] = once;", () => { let once = pass(nothing); const [a] = once; });
show("let once = pass(nothing); pass(...z);", () => { let once = pass(nothing); pass(...z); });
show("let once = pass(symbol); return `${once}`;", () => { let once = pass(symbol); return `${once}`; });
show("let once = pass(symbol); return once + \"\";", () => { let once = pass(symbol); return once + ""; });
show("let once = pass(symbol); return +once;", () => { let once = pass(symbol); return +once; });
show("let once = pass(five); return 1 in once;", () => { let once = pass(five); return 1 in once; });
show("let once = pass(five); return holder instanceof once;", () => { let once = pass(five); return holder instanceof once; });
show("let once = pass(five); return once instanceof five;", () => { let once = pass(five); return once instanceof five; });
show("let once = pass(nothing); once.x = 1;", () => { let once = pass(nothing); once.x = 1; });
show("let once = pass(nothing); once.x++;", () => { let once = pass(nothing); once.x++; });
show("let once = pass(nothing); delete once.x;", () => { let once = pass(nothing); delete once.x; });
show("let once = pass(nothing); return once[key];", () => { let once = pass(nothing); return once[key]; });
show("let once = pass(symbol); return holder[key][once];", () => { let once = pass(symbol); return holder[key][once]; });
show("let once = pass(nothing); throw once.x;", () => { let once = pass(nothing); throw once.x; });
show("let once = pass(nothing); if (once.x) {}", () => { let once = pass(nothing); if (once.x) {} });
show("let once = five; return once.x.y;", () => { let once = five; return once.x.y; });
show("let once = five; once();", () => { let once = five; once(); });
show("const once = holder.s; once();", () => { const once = holder.s; once(); });
show("const once = holder.s; return once.t.u;", () => { const once = holder.s; return once.t.u; });
show("const once = [nothing]; return once[0].x;", () => { const once = [nothing]; return once[0].x; });
show("const once = { a: nothing }; return once.a.x;", () => { const once = { a: nothing }; return once.a.x; });
show("const once = () => {}; return once.a.x;", () => { const once = () => {}; return once.a.x; });
show("const once = function () {}; return once.a.x;", () => { const once = function () {}; return once.a.x; });
show("const once = `a${five}`; once();", () => { const once = `a${five}`; once(); });
show("const once = five + 1; once();", () => { const once = five + 1; once(); });
show("const once = -five; once();", () => { const once = -five; once(); });
show("const once = five ? nothing : missing; once();", () => { const once = five ? nothing : missing; once(); });
show("const once = id`a`; once();", () => { const once = id`a`; once(); });
show("const once = (1, nothing); once();", () => { const once = (1, nothing); once(); });
show("const once = nothing ?? missing; once();", () => { const once = nothing ?? missing; once(); });
show("const once = typeof five; once();", () => { const once = typeof five; once(); });
show("const once = void 0; once();", () => { const once = void 0; once(); });
show("const once = [1, 2]; once();", () => { const once = [1, 2]; once(); });
show("const once = { a: 1 }; once();", () => { const once = { a: 1 }; once(); });
show("const once = /a/; once();", () => { const once = /a/; once(); });
show("const once = this; once();", () => { const once = this; once(); });
show("const once = five; const next = once; next();", () => { const once = five; const next = once; next(); });
show("const once = pass(nothing), next = 1; once(next);", () => { const once = pass(nothing), next = 1; once(next); });
