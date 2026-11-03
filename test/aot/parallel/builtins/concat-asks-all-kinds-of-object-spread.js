// Array.prototype.concat spreads an argument that says so under Symbol.isConcatSpreadable. Each argument here lies below Object.prototype and holds that member, or does not, in another way.
function show(label, argument) {
  console.log(label, JSON.stringify([].concat(argument).length), JSON.stringify(["first"].concat(argument, "last").length));
}

show("a literal", { [Symbol.isConcatSpreadable]: true, length: 2, 0: "a", 1: "b" });
show("a literal that says no", { [Symbol.isConcatSpreadable]: false, length: 2 });
show("a literal without it", { length: 2 });
show("a getter of a literal", { get [Symbol.isConcatSpreadable]() { return true; }, length: 2 });

const storedLater = { length: 2 };
storedLater[Symbol.isConcatSpreadable] = true;
show("stored later", storedLater);

const deleted = { [Symbol.isConcatSpreadable]: true, length: 2 };
delete deleted[Symbol.isConcatSpreadable];
show("deleted", deleted);

class WithField {
  [Symbol.isConcatSpreadable] = true;
  length = 2;
}
show("a field of an instance", Object.setPrototypeOf(new WithField(), Object.prototype));

class WithAccessor {
  get [Symbol.isConcatSpreadable]() {
    return true;
  }
  get length() {
    return 2;
  }
}
show("the prototype object of a class", WithAccessor.prototype);
show("an instance of that class", new WithAccessor());

class WithoutIt {
  get length() {
    return 2;
  }
}
show("the prototype object of a class without it", WithoutIt.prototype);

class WithStaticField {
  static [Symbol.isConcatSpreadable] = true;
}
show("a static field", Object.setPrototypeOf(WithStaticField, Object.prototype));

class WithStaticAccessor {
  static get [Symbol.isConcatSpreadable]() {
    return true;
  }
}
show("a static accessor", Object.setPrototypeOf(WithStaticAccessor, Object.prototype));

function declared(one, two) {}
declared[Symbol.isConcatSpreadable] = true;
show("a function", Object.setPrototypeOf(declared, Object.prototype));

show("an array that says no", Object.assign(["a", "b"], { [Symbol.isConcatSpreadable]: false }));
show("an array with another property", Object.assign(["a", "b"], { other: 1 }));
