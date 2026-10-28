// Prints the frames of errors that pass through constructors that are not written in the class.
const listFrames = error =>
  error.stack
    .split("\n")
    .slice(1, 6)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
    .join(" | ");
function show(label, call) {
  try {
    call();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, "|", listFrames(error));
  }
}
function fail() { throw new Error("fail"); }
class Throws { constructor() { fail(); } }
class Derived extends Throws {}
class DerivedTwice extends Derived {}
class HasField { x = fail(); }
class DerivedFromField extends HasField {}
class DerivedWithField extends Throws { z = 1; }
class FieldBehindSuper extends Object { w = fail(); }
show("derived", () => { new Derived(); });
show("derived twice", () => { new DerivedTwice(); });
show("field", () => { new HasField(); });
show("field of the parent", () => { new DerivedFromField(); });
show("derived with a field", () => { new DerivedWithField(); });
show("field behind super", () => { new FieldBehindSuper(); });
show("parent is a function", () => { function Parent() { fail(); } class Child extends Parent {} new Child(); });
