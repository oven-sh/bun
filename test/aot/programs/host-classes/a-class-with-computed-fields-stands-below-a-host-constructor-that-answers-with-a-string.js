// The parent of a class is swapped for a constructor of the host that answers `new` with a string. A field under a computed key cannot be defined on a string: a TypeError.
const { CString, ptr } = require("bun:ffi");
const bytes = Buffer.from("Hi\0");
const at = ptr(bytes);
function attempt(name, work) {
  try {
    console.log(name, work());
  } catch (error) {
    console.log(name, "threw", error.constructor.name);
  }
}

class Base {}
class WithIndex extends Base { [0] = 1; }
Object.setPrototypeOf(WithIndex, CString);
attempt("a field under an index", () => typeof new WithIndex(at));

class WithName extends Base { ["k" + 1] = 2; }
Object.setPrototypeOf(WithName, CString);
attempt("a field under a name that is computed", () => typeof new WithName(at));

class Untouched extends Base { [0] = 1; ["k" + 1] = 2; }
attempt("the parent as it was written", () => { const made = new Untouched(); return made[0] + made.k1; });
