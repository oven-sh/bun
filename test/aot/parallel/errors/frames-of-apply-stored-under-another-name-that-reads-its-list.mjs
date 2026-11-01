// Function.prototype.apply, stored under another name and called in tail position, reads its list in a frame of its own: the caller's frame is gone by then.
const frames = error => error.message.replace(/ \((In|evaluating) '.*$/, "") + " | " + String(error.stack).split("\n").filter(line => /^\s+at /.test(line)).slice(0, 4).map(line => line.trim().replace(/\(?[^\s(]*[\\/]([^\\/\s:]+:\d+:\d+)\)?/, "$1")).join(" < ");
const show = (label, run) => { try { console.log(label, String(run())); } catch (error) { console.log(label, frames(error)); } };
const apply = Function.prototype.apply;
const throwingElement = { length: 1, get 0() { throw new Error("read"); } };
const throwingLength = { get length() { throw new Error("length"); } };
function make() { const stored = (...all) => all.length; stored.run = apply; return stored; }
function numberTail(o) { return o.run(null, 5); }
function numberNotTail(o) { const r = o.run(null, 5); return r + 1; }
function textTail(o) { return o.run(null, "ab"); }
function elementTail(o) { return o.run(null, throwingElement); }
function elementNotTail(o) { const r = o.run(null, throwingElement); return r + 1; }
function lengthTail(o) { return o.run(null, throwingLength); }
function anyTail(o, list) { return o.run(null, list); }
function ownArgumentsTail(o) { return o.run(null, arguments); }
function ownArgumentsNotTail(o) { const r = o.run(null, arguments); return r + 1; }
function noFunctionTail(o, list) { return o.run(null, list); }
function noFunctionNotTail(o, list) { const r = o.run(null, list); return r + 1; }
function writtenTail(f) { return f.apply(null, 5); }
function writtenElementTail(f) { return f.apply(null, throwingElement); }
const arrowTail = o => o.run(null, 5);
class Holder {
  field = o => o.run(null, 5);
  static tail(o) { return o.run(null, 5); }
  tail(o) { return o.run(null, throwingElement); }
}
for (let round = 0; round < 2; round++) {
  show("numberTail", () => numberTail(make()));
  show("numberNotTail", () => numberNotTail(make()));
  show("textTail", () => textTail(make()));
  show("elementTail", () => elementTail(make()));
  show("elementNotTail", () => elementNotTail(make()));
  show("lengthTail", () => lengthTail(make()));
  show("anyTail number", () => anyTail(make(), 5));
  show("anyTail array", () => anyTail(make(), [1, 2]));
  show("anyTail object", () => anyTail(make(), { length: 3 }));
  show("anyTail null", () => anyTail(make(), null));
  show("anyTail element", () => anyTail(make(), throwingElement));
  show("ownArgumentsTail", () => ownArgumentsTail(make()));
  show("ownArgumentsNotTail", () => ownArgumentsNotTail(make()));
  show("ownArgumentsTail no function", () => ownArgumentsTail({ run: apply }));
  show("ownArgumentsNotTail no function", () => ownArgumentsNotTail({ run: apply }));
  show("noFunctionTail array", () => noFunctionTail({ run: apply }, [1]));
  show("noFunctionTail null", () => noFunctionTail({ run: apply }, null));
  show("noFunctionNotTail array", () => noFunctionNotTail({ run: apply }, [1]));
  show("noFunctionNotTail null", () => noFunctionNotTail({ run: apply }, null));
  show("writtenTail", () => writtenTail(make()));
  show("writtenElementTail", () => writtenElementTail(make()));
  show("arrowTail", () => arrowTail(make()));
  show("static method", () => Holder.tail(make()));
  show("method", () => new Holder().tail(make()));
  show("field", () => new Holder().field(make()));
}
