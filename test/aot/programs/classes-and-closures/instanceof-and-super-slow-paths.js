// instanceof through Symbol.hasInstance and Proxy traps, and super(..) on a class whose parent changed.
function errorName(run) {
  try {
    return "returned " + String(run());
  } catch (error) {
    return error.constructor.name;
  }
}

class Even {
  static [Symbol.hasInstance](value) {
    console.log("hasInstance", value);
    return value % 2 === 0;
  }
}
console.log("static hasInstance:", 4 instanceof Even, 5 instanceof Even);

const engineClasses = [Map];
for (const engineClass of engineClasses) {
  let answer;
  try {
    Object.defineProperty(engineClass, Symbol.hasInstance, { value: () => true, configurable: true });
    answer = {} instanceof engineClass;
    delete engineClass[Symbol.hasInstance];
  } catch (error) {
    answer = error instanceof TypeError;
  }
  console.log("hasInstance on a built-in class:", answer);
}
console.log("map after:", new Map() instanceof Map, {} instanceof Map);

class Animal {}
class Dog extends Animal {}
const throwingChain = Object.create(new Proxy({}, {
  getPrototypeOf() {
    throw new RangeError("no prototype");
  },
}));
console.log("throwing getPrototypeOf:", errorName(() => throwingChain instanceof Animal));
console.log("primitive on the left:", 5 instanceof Animal);

const unknownRight = [5, {}, () => {}];
console.log("right is a number:", errorName(() => ({}) instanceof unknownRight[0]));
console.log("right is a plain object:", errorName(() => ({}) instanceof unknownRight[1]));
console.log("right is an arrow function:", errorName(() => ({}) instanceof unknownRight[2]));

class First {
  constructor(label) {
    this.parent = "First";
    this.label = label;
  }
}
class Other {
  constructor(label) {
    this.parent = "Other";
    this.label = label;
    this.target = new.target;
  }
}
class Child extends First {
  constructor(...args) {
    super(...args);
  }
}
class FixedChild extends First {
  constructor(label) {
    super(label);
  }
}
console.log("before reparenting:", new Child("a").parent, new FixedChild("b").parent);
Object.setPrototypeOf(Child, Other);
Object.setPrototypeOf(FixedChild, Other);
const reparented = new Child("c");
console.log("reparented spread:", reparented.parent, reparented.label, reparented.target === Child, reparented instanceof First);
console.log("reparented fixed:", new FixedChild("d").parent);
Object.setPrototypeOf(Child, null);
Object.setPrototypeOf(FixedChild, null);
console.log("null parent spread:", errorName(() => new Child("e")));
console.log("null parent fixed:", errorName(() => new FixedChild("f")));

class ReparentedByArgument extends First {
  constructor(parent) {
    super(Object.setPrototypeOf(ReparentedByArgument, parent) && "g");
  }
}
class ReparentedBySpreadArgument extends First {
  constructor(parent) {
    super(...[Object.setPrototypeOf(ReparentedBySpreadArgument, parent) && "h"]);
  }
}
console.log("argument reparents:", new ReparentedByArgument(Other).parent, Object.getPrototypeOf(ReparentedByArgument) === Other);
console.log("spread argument reparents:", new ReparentedBySpreadArgument(Other).parent, Object.getPrototypeOf(ReparentedBySpreadArgument) === Other);
Object.setPrototypeOf(ReparentedByArgument, First);
Object.setPrototypeOf(ReparentedBySpreadArgument, First);
console.log("argument removes parent:", errorName(() => new ReparentedByArgument(null).parent));
console.log("spread argument removes parent:", errorName(() => new ReparentedBySpreadArgument(null).parent));

class CustomError extends Error {
  constructor(message) {
    super(message);
    this.name = "CustomError";
  }
}
const customError = new CustomError("broken");
console.log("error subclass:", customError instanceof CustomError, customError instanceof Error, customError.message, customError.name);

const dog = new Dog();
console.log("plain hierarchy:", dog instanceof Dog, dog instanceof Animal, new Animal() instanceof Dog, dog instanceof Object);
console.log("plain built-in:", [] instanceof Array, new Map() instanceof Map, [] instanceof Map);
