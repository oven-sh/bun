// Flags: --aot-check=verify-each-pass
// map() tests the form of its list once, ahead of its loop. The callback constructs an object whose constructor keeps what it is handed and may throw a name that nobody declares.
// What the constructor writes through its parameter it does not write to the list, also where the call goes to a version of it that is handed its `this`.
function isName(name) {
  return name !== "";
}
function assertName(name) {
  if (!isName(name)) throw NoSuchError;
}
class Argument {
  constructor(parent, name) {
    this.parent = parent;
    assertName(name);
  }
}
class Directive {
  constructor(config) {
    this.args = Object.entries(config).map(entry => new Argument(this, entry[0]));
  }
}
var include = new Directive({ if: 1 });
var skip = new Directive({ if: 1, unless: 2 });
console.log(include.args.length, skip.args.length, skip.args[1].parent === skip);
try {
  new Directive({ "": 1 });
} catch (error) {
  console.log(error.name);
}
