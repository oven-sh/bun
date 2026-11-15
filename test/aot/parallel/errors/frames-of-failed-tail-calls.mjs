// JSC pops the frame before a tail call finds that its callee is not callable. It lists that frame without its function object:
// under the name as written, and a built-in without "native".
const frames = error => error.message.replace(/ \((In|evaluating) '.*$/, "") + " | " + String(error.stack).split("\n").filter(line => /^\s+at /.test(line)).slice(0, 3).map(line => line.trim().replace(/\(?[^\s(]*[\\/]([^\\/\s:]+:\d+:\d+)\)?/, "$1")).join(" < ");
const show = (label, run) => { try { console.log(label, String(run())); } catch (error) { console.log(label, frames(error)); } };
const hide = value => [value][0];
function tail(g) { return g(); }
Object.defineProperty(tail, "name", { value: "renamedTail" });
function notTail(g) { const r = g(); return r + 1 + r; }
Object.defineProperty(notTail, "name", { value: "renamedNotTail" });
function tailMember(o) { return o.missing(); }
tailMember.displayName = "shownTailMember";
function notTailMember(o) { const r = o.missing(); return r + 1 + r; }
notTailMember.displayName = "shownNotTailMember";
const arrow = g => g();
Object.defineProperty(arrow, "name", { value: "renamedArrow" });
const holder = { method(g) { return g(); } };
Object.defineProperty(holder.method, "name", { value: "renamedMethod" });
function hiddenTail(g) { return g(); }
Object.defineProperty(hiddenTail, "name", { value: "renamedHiddenTail" });
const hiddenHolder = { method(g) { return g(1, 2, 3, 4, 5, 6, 7, 8); } };
Object.defineProperty(hiddenHolder.method, "name", { value: "renamedHiddenMethod" });
hiddenTail(() => 1);
hiddenHolder.method(() => 1);
const key = "computed" + hide("Key");
class Kinds {
  get getter() { return this.missing(); }
  static method(g) { return g(); }
  [key](g) { return g(); }
  #hidden(g) { return g(); }
  viaHidden(g) { const r = this.#hidden(g); return r + 1 + r; }
}
const inferred = function (g) { return g(); };
const list = [function (g) { return g(); }, g => g()];
function entered(g) { return g(); }
Object.defineProperty(entered, "name", { value: "renamedEntered" });
function outer(g) { const r = tail(g); return r + 1 + r; }
function conditional(g, h) { return g ? g() : h(); }
Object.defineProperty(conditional, "name", { value: "renamedConditional" });
for (let round = 0; round < 2; round++) {
  show("tail", () => tail(1));
  show("tail of a hidden value", () => hiddenTail(hide(round)));
  show("method of a hidden value", () => hiddenHolder.method(hide(round)));
  show("notTail", () => notTail(1));
  show("tailMember", () => tailMember({}));
  show("notTailMember", () => notTailMember({}));
  show("arrow", () => arrow(1));
  show("method", () => holder.method(1));
  show("getter", () => new Kinds().getter);
  show("static method", () => Kinds.method(hide(1)));
  show("computed key", () => new Kinds()[key](hide(1)));
  show("private method", () => new Kinds().viaHidden(hide(1)));
  show("inferred name", () => inferred(hide(1)));
  show("anonymous function", () => list[0](hide(1)));
  show("anonymous arrow", () => list[1](hide(1)));
  show("entered", () => entered(() => { throw new Error("entered"); }));
  show("outer", () => outer(1));
  show("conditional", () => conditional(0, 1));
  show("call", () => { const call = Function.prototype.call; return call(null); });
  show("apply", () => { const apply = Function.prototype.apply; return apply(null, []); });
}
