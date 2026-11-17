// f.call(..) and f.apply(..) of functions that other code holds: the check of the closure takes the place of the read, and whatever f gets of its own is found.
// STATISTIC: ForwardedCallsCheckedByClosure >= 12
const log = (...words) => console.log(...words);
const take = globalThis[process.argv[9] || "none"] || (x => x);
function plain(a, b) { return [this && this.name, a, b, arguments.length].join(); }
function strict(a, b) { return [typeof this, a, b].join(); }
function named() { return "named " + (this === undefined ? "undefined" : typeof this); }
function replaced(a) { return "replaced by nobody " + a; }
function changed(a) { return "changed " + a; }
function frozen(a) { return "frozen " + a; }
function heir(a) { return "heir " + a; }
function nothing(a) { return "nothing " + a; }
function deleted(a) { return "deleted " + a; }
function throws(a) { throw new RangeError("thrown " + a); }
async function later(a) { return "later " + a; }
function* many(a) { yield "many " + a; }
const arrow = a => "arrow " + a;
class Class { constructor() { this.x = 1; } method(a) { return this.name + " method " + a; } static make(a) { return "make " + a; } }
for (const f of [plain, strict, named, replaced, changed, frozen, heir, nothing, deleted, throws, later, many, arrow, Class]) take(f);
const o = { name: "o" };
function callPlain(x) { return plain.call(o, x, x + 1); }
function callMore(x) { return plain.call(o, x, x, x, x, x); }
function callFewer() { return plain.call(o); }
function callNone() { return plain.call(); }
function applyPlain(x) { return plain.apply(o, [x, x + 2]); }
function applyArguments() { return plain.apply(this, arguments); }
function applyNothing() { return plain.apply(o, null); }
function callTyped(x) { return strict.call(x, x, 2); }
function callNamed(x) { return named.call(x); }
function callReplaced(x) { return replaced.call(o, x); }
function callChanged(x) { return changed.call(o, x()); }
function callFrozen(x) { return frozen.call(o, x); }
function callHeir(x) { return heir.call(o, x); }
function callNothing(x) { return nothing.call(o, x); }
function callDeleted(x) { return deleted.call(o, x); }
function callThrows(x) { return throws.call(o, x); }
function callLater(x) { return later.call(o, x); }
function callMany(x) { return [...many.call(o, x)].join(); }
function callArrow(x) { return arrow.call(o, x); }
function callClass(x) { return Class.call(o, x); }
function callMethod(x) { return Class.prototype.method.call(o, x); }
function callMake(x) { return Class.make.call(o, x); }
const calls = { callPlain, callMore, callFewer, callNone, applyPlain, applyArguments, applyNothing, callTyped, callNamed, callReplaced, callFrozen, callHeir, callNothing, callDeleted, callThrows, callMany, callArrow, callClass, callMethod, callMake };
function all(when) {
  for (const name of Object.keys(calls)) {
    let answer;
    try { answer = calls[name].call(o, 3, 4); } catch (error) { answer = error.constructor.name + " " + error.message; }
    log(when, name, answer);
  }
}
all("first");
replaced.call = function (self, x) { return "own call " + self.name + x; };
log(callChanged(() => 1), callChanged(() => { changed.call = () => "own call comes too late"; return 2; }), callChanged(() => 3));
Object.freeze(frozen);
Object.setPrototypeOf(heir, { call(self, x) { return "inherited call " + self.name + x; } });
Object.setPrototypeOf(nothing, null);
deleted.call = () => "own";
log(callDeleted(5));
delete deleted.call;
plain.other = 1;
all("second");
Object.defineProperty(plain, "call", { get() { return () => "by getter"; }, configurable: true });
Object.defineProperty(plain, "apply", { value: () => "own apply" });
all("third");
delete plain.call;
all("fourth");
function visit(node, by) {
  if (strict.call(node, by) === "") return 0;
  let sum = node.weight;
  for (const kid of node.kids) sum += visit.call(undefined, kid, by + 1);
  return named.call(node) === "named object" ? sum : -sum;
}
take(visit);
const tree = depth => ({ weight: depth, kids: depth ? [tree(depth - 1), tree(depth - 1)] : [] });
log(visit(tree(6), 1));
callLater(7).then(log);
