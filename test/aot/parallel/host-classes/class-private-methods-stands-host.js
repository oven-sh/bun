// The parent of a class is swapped for a constructor of the host that answers `new` with a string. The private methods of the class are not there on a string: asking for one is a TypeError.
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
class WithMethod extends Base { #m() { return 4; } static call(made) { return made.#m(); } }
Object.setPrototypeOf(WithMethod, CString);
attempt("a private method", () => WithMethod.call(new WithMethod(at)));

class WithGetter extends Base { get #g() { return 5; } static read(made) { return made.#g; } }
Object.setPrototypeOf(WithGetter, CString);
attempt("a private getter", () => WithGetter.read(new WithGetter(at)));

class WithBoth extends Base { #m() { return 6; } #f = 7; static call(made) { return made.#m() + made.#f; } }
Object.setPrototypeOf(WithBoth, CString);
attempt("a private method and a private field", () => WithBoth.call(new WithBoth(at)));

class Untouched extends Base { #m() { return 8; } static call(made) { return made.#m(); } }
attempt("the parent as it was written", () => Untouched.call(new Untouched()));
for (let turn = 0; turn < 3; turn++) attempt("again", () => WithMethod.call(new WithMethod(at)));
// The address is good for as long as the bytes are held.
console.log("the bytes", bytes.join());
