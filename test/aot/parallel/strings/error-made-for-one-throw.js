// each class of error is made with a written message and thrown at once; the caller looks at class, message, identity, own keys; one throw stands under a handler of its own function, one error is kept, one is of a subclass
class Mine extends TypeError {}
function plain() { throw new Error("plain"); }
function type() { throw new TypeError("bad input"); }
function range() { throw new RangeError("out of range"); }
function called() { throw SyntaxError("called without new"); }
function empty() { throw new URIError(""); }
function withCause() { throw new Error("outer", { cause: 5 }); }
function mine() { throw new Mine("mine"); }
function caughtHere() { try { throw new TypeError("inside"); } catch (e) { e.message += " and changed"; return e; } }
function kept() { const e = new EvalError("kept"); e.extra = 1; throw e; }
function onOnePath(flag) { if (flag) throw new ReferenceError("taken"); return "passed"; }
function look(f, ...rest) {
  try { const given = f(...rest); return given instanceof Error ? "returned " + given.message : String(given); } catch (e) {
    return [e.name, JSON.stringify(e.message), e.constructor.name, e instanceof TypeError, Object.getPrototypeOf(e) === e.constructor.prototype, Object.getOwnPropertyNames(e).filter(k => k !== "stack" && k !== "line" && k !== "column" && k !== "sourceURL" && k !== "originalLine" && k !== "originalColumn").join(), e.cause, e.extra].join(" ");
  }
}
function twice(f) { let a, b; try { f(); } catch (e) { a = e; } try { f(); } catch (e) { b = e; } return a !== b; }
for (let turn = 0; turn < 3; turn++) {
  for (const f of [plain, type, range, called, empty, withCause, mine, caughtHere, kept])
    console.log(look(f), twice(f));
  console.log(look(onOnePath, true), look(onOnePath, false));
}
