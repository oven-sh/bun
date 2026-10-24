// A direct eval that stands outside a class may store to the variable that the class declaration binds, as any code there may. One that stands in the body of the class sees the binding that is fixed.
function attempt(label, run) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, error.constructor.name);
  }
}
class Seen { static kind = "seen"; who() { return Seen; } }
const first = new Seen();
attempt("eval reads", () => eval("typeof Seen + Seen.kind"));
attempt("eval stores", () => eval("Seen = 5"));
attempt("what eval stored", () => [Seen, first.who().kind]);

class Fixed { static viaEval() { return eval("Fixed = 2"); } }
attempt("from within", () => Fixed.viaEval());
attempt("still the class", () => typeof Fixed);

function inner() {
  class Local { static n = 1; }
  const before = Local;
  eval("Local = 7");
  return [typeof before, Local];
}
attempt("in a function", inner);
