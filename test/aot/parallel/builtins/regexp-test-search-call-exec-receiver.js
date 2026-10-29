// RegExp.prototype.test and String.prototype.search read `exec` off their receiver and call it. Each receiver here lies below RegExp.prototype, is no RegExp, and holds `exec`, or does not, in another way.
function attempt(label, receiver) {
  for (const [method, run] of [
    ["test", () => RegExp.prototype.test.call(receiver, "text")],
    ["search", () => "text".search(receiver)],
  ]) {
    try {
      console.log(label, method, run(), Object.hasOwn(receiver, "lastIndex"));
    } catch (error) {
      console.log(label, method, error.constructor.name, error.message, Object.hasOwn(receiver, "lastIndex"));
    }
  }
}
const found = () => Object.assign(["ex"], { index: 1 });

attempt("a method of a literal", { __proto__: RegExp.prototype, exec() { return null; } });
attempt("a method that finds", { __proto__: RegExp.prototype, exec() { return found(); } });
attempt("an arrow in a literal", { __proto__: RegExp.prototype, exec: () => found() });
attempt("a getter of a literal", { __proto__: RegExp.prototype, get exec() { return () => null; } });
attempt("a literal without it", { __proto__: RegExp.prototype, other: 1 });
attempt("undefined in a literal", { __proto__: RegExp.prototype, exec: undefined });
attempt("a number in a literal", { __proto__: RegExp.prototype, exec: 1 });
attempt("what is no match", { __proto__: RegExp.prototype, exec() { return 1; } });
attempt("a literal linked later", Object.setPrototypeOf({ exec() { return null; } }, RegExp.prototype));

const storedLater = { __proto__: RegExp.prototype, other: 1 };
storedLater.exec = () => found();
attempt("stored later", storedLater);

const definedLater = { __proto__: RegExp.prototype, other: 1 };
Object.defineProperty(definedLater, "exec", { value: () => null });
attempt("defined later", definedLater);

const deleted = { __proto__: RegExp.prototype, exec() { return null; } };
delete deleted.exec;
attempt("deleted", deleted);

const underAKey = { __proto__: RegExp.prototype };
underAKey[["ex", "ec"].join("")] = () => null;
attempt("stored under a key", underAKey);

class WithField {
  exec = () => found();
}
attempt("a field of an instance", Object.setPrototypeOf(new WithField(), RegExp.prototype));

class WithMethod {
  exec() {
    return null;
  }
}
Object.setPrototypeOf(WithMethod.prototype, RegExp.prototype);
attempt("a method of a class", new WithMethod());
attempt("the prototype object of a class", WithMethod.prototype);

class WithStaticMethod {
  static exec() {
    return found();
  }
}
attempt("a static method", Object.setPrototypeOf(WithStaticMethod, RegExp.prototype));

class WithStaticField {
  static exec = () => null;
}
attempt("a static field", Object.setPrototypeOf(WithStaticField, RegExp.prototype));

class WithoutStatics {}
attempt("a class without it", Object.setPrototypeOf(WithoutStatics, RegExp.prototype));

function declared() {}
declared.exec = () => found();
attempt("a function", Object.setPrototypeOf(declared, RegExp.prototype));

attempt("one step further up", { __proto__: { __proto__: RegExp.prototype, exec() { return null; } } });
attempt("frozen", Object.freeze({ __proto__: RegExp.prototype, exec() { return found(); } }));
attempt("an error", Object.setPrototypeOf(new Error("none"), RegExp.prototype));
attempt("an error with it", Object.setPrototypeOf(Object.assign(new Error("one"), { exec: () => null }), RegExp.prototype));

class Heir extends RegExp {
  exec() {
    return null;
  }
}
attempt("an heir of RegExp", new Heir("t"));
attempt("a RegExp with its own", Object.assign(/t/, { exec: () => null }));
attempt("a RegExp with another property", Object.assign(/x/, { other: 1 }));
attempt("a RegExp", /x/);
