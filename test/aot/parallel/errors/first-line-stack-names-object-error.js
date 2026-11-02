// The first line of `stack`, and what is printed for an error, begin with the `name` that the error or the object above it holds as a data property. Each object above an error here holds `name`, or does not, in another way.
function show(label, above) {
  const error = Object.setPrototypeOf(new Error(label), above);
  console.log(String(error.stack).split("\n")[0], "|", Bun.inspect(error).split("\n").findLast(line => line.includes(label)));
}

show("a literal", { name: "Literal" });
show("a literal below Error.prototype", { __proto__: Error.prototype, name: "Below" });
show("a number", { name: 12 });
show("undefined", { name: undefined });
show("an object", { name: {} });
show("a getter", { get name() { return "Getter"; } });
show("a literal without it", { other: 1 });
show("two steps up", { __proto__: { name: "TooFar" } });

const storedLater = { other: 1 };
storedLater.name = "StoredLater";
show("stored later", storedLater);

const storedAgain = { name: "First" };
delete storedAgain.name;
show("deleted", storedAgain);
storedAgain.name = "Again";
show("stored again", storedAgain);

const defined = {};
Object.defineProperty(defined, "name", { value: "Defined" });
show("defined", defined);

show("frozen", Object.freeze({ name: "Frozen" }));

class WithField {
  name = "Field";
}
show("an instance", new WithField());

class AssignsInConstructor {
  constructor() {
    this.name = "Assigned";
  }
}
show("an instance that was assigned to", new AssignsInConstructor());

class WithStaticField {
  static name = "StaticField";
}
show("a class with a static field", WithStaticField);

class WithStaticMethod {
  static name() {}
}
show("a class with a static method", WithStaticMethod);

class WithAccessor {
  get name() {
    return "Accessor";
  }
}
show("the prototype object of a class", WithAccessor.prototype);

function Made(message) {
  return Object.setPrototypeOf(new Error(message), Made.prototype);
}
Made.prototype = { __proto__: Error.prototype, name: "Made", constructor: Made };
console.log(String(Made("by a function").stack).split("\n")[0]);

class Heir extends Error {}
Heir.prototype.name = "HeirName";
console.log(String(new Heir("of Error").stack).split("\n")[0]);

class HeirWithField extends Error {
  name = "HeirField";
}
console.log(String(new HeirWithField("of Error").stack).split("\n")[0]);

const left = Object.setPrototypeOf(new Error("same"), { name: "Left" });
const right = Object.setPrototypeOf(new Error("same"), { name: "Right" });
console.log(Bun.deepEquals(left, right), Bun.deepEquals(left, Object.setPrototypeOf(new Error("same"), { name: "Left" })));
