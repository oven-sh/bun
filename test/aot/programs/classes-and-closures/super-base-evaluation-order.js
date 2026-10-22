// The super base is read before the key and the right-hand side run, and once for a compound assignment.
function createParent(name) {
  return {
    get x() {
      console.log(`  ${name} getter`);
      return name;
    },
    set x(value) {
      console.log(`  ${name} setter with ${value}`);
    },
  };
}
const first = createParent("first");
const second = createParent("second");

function attempt(label, action) {
  console.log(label);
  try {
    console.log(`  returned ${action()}`);
  } catch (error) {
    console.log(`  ${error.name}`);
  }
}

function createLiteral() {
  const literal = {
    __proto__: first,
    assign(change) {
      return (super.x = (change(literal), "by name"));
    },
    assignKey(change, key) {
      return (super[key] = (change(literal), "by key"));
    },
    assignChangingKey(change) {
      return (super[(change(literal), "x")] = "by a changing key");
    },
    readChangingKey(change) {
      return super[(change(literal), "x")];
    },
    append(change) {
      return (super.x += (change(literal), " appended"));
    },
    appendKey(change, key) {
      return (super[key] += (change(literal), " appended by key"));
    },
  };
  return literal;
}

function createClass() {
  class Base {}
  Object.setPrototypeOf(Base.prototype, first);
  Object.setPrototypeOf(Base, first);
  return class Derived extends Base {
    assign(change) {
      return (super.x = (change(Derived.prototype), "by name"));
    }
    append(change) {
      return (super.x += (change(Derived.prototype), " appended"));
    }
    static assign(change) {
      return (super.x = (change(Derived), "by name"));
    }
    static readChangingKey(change) {
      return super[(change(Derived), "x")];
    }
  };
}

const changes = [
  ["the parent becomes second", home => Object.setPrototypeOf(home, second)],
  ["the parent becomes null", home => Object.setPrototypeOf(home, null)],
  ["the parent stays", () => {}],
];

for (const [label, change] of changes) {
  console.log(`== ${label}`);
  attempt("literal, assign", () => createLiteral().assign(change));
  attempt("literal, assign by key", () => createLiteral().assignKey(change, "x"));
  attempt("literal, assign by a changing key", () => createLiteral().assignChangingKey(change));
  attempt("literal, read by a changing key", () => createLiteral().readChangingKey(change));
  attempt("literal, append", () => createLiteral().append(change));
  attempt("literal, append by key", () => createLiteral().appendKey(change, "x"));
  attempt("method, assign", () => new (createClass())().assign(change));
  attempt("method, append", () => new (createClass())().append(change));
  attempt("static method, assign", () => createClass().assign(change));
  attempt("static method, read by a changing key", () => createClass().readChangingKey(change));
}
