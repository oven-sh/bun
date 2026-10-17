// A class declaration binds a variable, like `let`: code outside the class may store to it. Only the binding that the body of the class sees is fixed.
function attempt(label, run) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, error.constructor.name);
  }
}
class Box { static kind = "box"; who() { return Box; } }
const first = new Box();
function swap(value) { Box = value; }
attempt("as declared", () => [typeof Box, Box.kind, Box.name, first instanceof Box]);
attempt("another class", () => { swap(class Other { static kind = "other"; }); return [typeof Box, Box.kind, first.who().kind, first instanceof Box, new Box() instanceof first.who()]; });
attempt("a number", () => { swap(1); return [typeof Box, first.who().kind]; });

class Fixed { static store() { Fixed = 1; } }
attempt("from within", () => Fixed.store());
attempt("still the class", () => typeof Fixed);

class Merged { static n = 1; }
Merged ||= {};
Merged ??= {};
attempt("never stored to", () => [typeof Merged, Merged.n]);

function inner() {
  class Local { static n = 1; }
  const before = Local;
  [Local] = [5];
  return [typeof before, Local];
}
attempt("in a function", inner);

class Base { hello() { return "base"; } }
class Derived extends Base {}
Base = class { hello() { return "replaced"; } };
attempt("what extended it", () => [new Derived().hello(), new Base().hello(), new Derived() instanceof Base]);

class Counted {}
attempt("++", () => { Counted++; return Counted; });
for (Counted of ["of a loop"]);
attempt("for of", () => Counted);

class Followed {}
(function () { Followed = "what follows the body is a statement of its own"; })();
attempt("an expression behind the body", () => Followed);
