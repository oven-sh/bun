// Each line: the message where what `apply` is called on is no function: it names the member that was called, as written.
// What a refused call with a list of arguments names.
// Flags: --aot-limit=MaxWarmCodeValues:1
const show = (label, run) => { try { console.log(label, run()); } catch (error) { console.log(label, error.name, error.message.replace(/\(In '([^(]*)\(.*\)', /, "(In '$1()', ")); } };
const notCallable = Object.create(Function.prototype);
const holder = { f: notCallable, deep: { f: notCallable } };
function tail(f, list) { return f.apply(null, list); }
function kept(f, list) { const result = f.apply(null, list); return [result]; }
function member(o, list) { const result = o.f.apply(o, list); return [result]; }
function deep(o, list) { const result = o.deep.f.apply(o, list); return [result]; }
function bracket(f, list) { const result = f["apply"](null, list); return [result]; }
function chain(f, list) { const result = f?.apply(null, list); return [result]; }
function noList(f) { const result = f.apply(null); return [result]; }
function noArguments(f) { const result = f.apply(); return [result]; }
function spread(f, list) { const result = f(...list); return [result]; }
function spreadMember(o, list) { const result = o.f(...list); return [result]; }
function throughCall(f, list) { const result = Function.prototype.apply.call(f, null, list); return [result]; }
function throughVariable(f, list) { const apply = Function.prototype.apply; const bound = apply.bind(f); return [bound(null, list), apply]; }
function throughReflect(f, list) { const result = Reflect.apply(f, null, list); return [result]; }
function strictTail(f, list) { "use strict"; return f.apply(null, list); }
for (const list of [[], [1], [1, 2, 3], Array.from({ length: 40 }, (_, i) => i)]) {
  show("kept", () => kept(notCallable, list));
  show("member", () => member(holder, list));
  show("deep", () => deep(holder, list));
  show("bracket", () => bracket(notCallable, list));
  show("chain", () => chain(notCallable, list));
  show("noList", () => noList(notCallable));
  show("noArguments", () => noArguments(notCallable));
  show("spread", () => spread(notCallable, list));
  show("spreadMember", () => spreadMember(holder, list));
  show("throughCall", () => throughCall(notCallable, list));
  show("throughVariable", () => throughVariable(notCallable, list));
  show("throughReflect", () => throughReflect(notCallable, list));
}
show("works", () => kept(function () { return arguments.length; }, [1, 2]));
