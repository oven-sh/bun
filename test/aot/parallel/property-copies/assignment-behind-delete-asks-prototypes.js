// Object.assign() stores: where the target has lost the property, a setter or a read-only property of a prototype answers, however often the same two shapes have met before.
// Nothing here reads the fields or lists the keys of the targets.
const lines = [];

class WithSetter { set k(value) { throw new RangeError("the setter got " + value); } }
class BelowSetter extends WithSetter { k; }

class WithQuietSetter { set k(value) { lines.push("the quiet setter got " + value); } }
class BelowQuietSetter extends WithQuietSetter { k = 1; }

class WithGetterAlone { get k() { return "inherited"; } }
class BelowGetterAlone extends WithGetterAlone { k; }

class WithReadOnly {}
Object.defineProperty(WithReadOnly.prototype, "k", { value: "fixed", writable: false, configurable: true });
class BelowReadOnly extends WithReadOnly { k; }

class WithTwoSetters { set b(value) { throw new RangeError("b got " + value); } }
class BelowTwo extends WithTwoSetters { a = 0; b = 0; c = 0; }

class Plain {}
class BelowPlain extends Plain { k; }

function attempt(what, action) {
  try {
    action();
    lines.push(what + ": stored");
  } catch (error) {
    lines.push(what + ": " + error.name + " " + error.message);
  }
}

function assignDeleteAssign(what, make) {
  const target = make();
  attempt(what + ", there", () => Object.assign(target, { k: 5 }));
  delete target.k;
  attempt(what + ", deleted", () => Object.assign(target, { k: 6 }));
  attempt(what + ", deleted still", () => Object.assign(target, { k: 7 }));
}

function threeFields() {
  const target = new BelowTwo;
  attempt("three fields, there", () => Object.assign(target, { a: 1, b: 2, c: 3 }));
  delete target.b;
  attempt("three fields, the middle one deleted", () => Object.assign(target, { a: 4, b: 5, c: 6 }));
}

function spreadDefines() {
  const target = new BelowSetter;
  Object.assign(target, { k: 5 });
  delete target.k;
  attempt("a definition asks nobody", () => Object.defineProperty(target, "k", { value: 8, writable: true, enumerable: true, configurable: true }));
  attempt("and the property is there again", () => Object.assign(target, { k: 9 }));
}

for (let turn = 0; turn < 40; turn++) {
  if (turn && turn < 39)
    lines.length = 0;
  assignDeleteAssign("a setter that throws", () => new BelowSetter);
  assignDeleteAssign("a setter", () => new BelowQuietSetter);
  assignDeleteAssign("a getter alone", () => new BelowGetterAlone);
  assignDeleteAssign("a read-only property", () => new BelowReadOnly);
  assignDeleteAssign("nothing inherited", () => new BelowPlain);
  threeFields();
  spreadDefines();
}
console.log(lines.join("\n"));
