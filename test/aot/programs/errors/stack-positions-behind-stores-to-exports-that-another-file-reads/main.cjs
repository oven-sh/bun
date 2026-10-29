// A conversion to a string has no place of its own in a stack trace: its caller is reported where the last operation in front of it stands. Here that is
// a store to a member of `exports`, or a read of one, in a program whose files know each other's exports.
const library = require("./library.cjs");
const { Empty, Model, Second } = require("./library.cjs");
const { show, id } = require("./show.cjs");
console.log(
  typeof Empty,
  typeof Model,
  typeof Second,
  typeof library.Nameless,
  library.five,
  library.counted,
  library.first,
  library.second,
);
function work() {
  id(0);
  id(new library.Model(`${{ toString: () => String(show("new library.A(")) }}`));
  id(0);
  id(library.work(`${{ toString: () => String(show("library.f(")) }}`));
  id(0);
  id(library.five, `${{ toString: () => String(show("library.n,")) }}`);
  id(0);
  id(library.work`a${`${{ toString: () => String(show("library.f as a tag")) }}`}`);
  id(0);
  id(new Model(`${{ toString: () => String(show("new A(")) }}`));
  id(0);
  id((0, library.work)(`${{ toString: () => String(show("(0, library.f)(")) }}`));
  id(0);
  id(require("./library.cjs").run(`${{ toString: () => String(show("require(..).f(")) }}`));
  id(0);
  id(new (require("./library.cjs").Derived)(`${{ toString: () => String(show("new (require(..).A)(")) }}`));
  id(0);
  return new library.Second(`${{ toString: () => String(show("return new library.A(")) }}`.length, id(1));
}
work();
