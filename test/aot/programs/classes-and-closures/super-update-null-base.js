// An update of `super[key]` whose super base is null throws a TypeError before the key is converted.
const steps = [];
const key = {
  toString() {
    steps.push("key converted");
    return "x";
  },
};
function attempt(title, run) {
  let outcome;
  try {
    outcome = `returned ${run()}`;
  } catch (error) {
    outcome = error.constructor.name;
  }
  console.log(`${title}: ${outcome}`, JSON.stringify(steps.splice(0)));
}

function createLiteral(parent) {
  return {
    __proto__: parent,
    add(key) {
      return (super[key] += 1);
    },
    increment(key) {
      return super[key]++;
    },
    decrement(key) {
      return --super[key];
    },
    assignIfNullish(key) {
      return (super[key] ??= 1);
    },
    assignIfTruthy(key) {
      return (super[key] &&= 2);
    },
  };
}

for (const update of ["add", "increment", "decrement", "assignIfNullish", "assignIfTruthy"]) {
  attempt(`literal without a parent, ${update}`, () => createLiteral(null)[update](key));
  attempt(`literal without a parent, ${update}, string key`, () => createLiteral(null)[update]("x"));
  attempt(`literal with a parent, ${update}`, () => createLiteral({ x: 5 })[update](key));
}

class Rootless extends null {
  add(key) {
    return (super[key] += 1);
  }
  static add(key) {
    return (super[key] += 1);
  }
}
attempt("method of a class that extends null", () => Rootless.prototype.add.call({}, key));
attempt("static method of a class that extends null", () => Rootless.add(key));

class Base {}
class Derived extends Base {
  add(key) {
    return (super[key] += 1);
  }
}
attempt("method, parent in place", () => new Derived().add(key));
Object.setPrototypeOf(Derived.prototype, null);
attempt("method, parent removed", () => Derived.prototype.add.call({}, key));
