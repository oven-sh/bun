// The message for a non-object super base differs between `bun run` and compiled code, so errors print their name.
function attempt(label, action) {
  try {
    console.log(`${label}: ${action()}`);
  } catch (error) {
    console.log(`${label}: ${error.name}`);
  }
}

class Base {
  constructor(label) {
    this.label = label;
  }
  method() {
    return `Base.method on ${this.label}`;
  }
  get accessor() {
    return `getter on ${this.label}`;
  }
  set accessor(value) {
    console.log(`setter on ${this.label} with ${value}`);
  }
  static staticMethod() {
    return `Base.staticMethod on ${this.name}`;
  }
  static get staticAccessor() {
    return `static getter on ${this.name}`;
  }
  static set staticAccessor(value) {
    console.log(`static setter on ${this.name} with ${value}`);
  }
}
Base.prototype.data = "inherited data";
Object.defineProperty(Base.prototype, "readOnly", { value: "fixed", writable: false });

class Derived extends Base {
  readMethod() {
    return super.method();
  }
  readAccessor() {
    return super.accessor;
  }
  readData() {
    return super.data;
  }
  readAbsent() {
    return super.absent;
  }
  readKey(key) {
    return super[key];
  }
  writeAccessor(value) {
    super.accessor = value;
  }
  writeOwn(value) {
    super.created = value;
    return Object.hasOwn(this, "created") ? this.created : "not own";
  }
  writeKey(key, value) {
    super[key] = value;
    return this[key];
  }
  writeReadOnly() {
    super.readOnly = "changed";
    return this.readOnly;
  }
  static readStatic() {
    return super.staticMethod();
  }
  static readStaticAccessor() {
    return super.staticAccessor;
  }
  static readStaticKey(key) {
    return super[key];
  }
  static writeStaticAccessor(value) {
    super.staticAccessor = value;
  }
}

const derived = new Derived("derived");
console.log(derived.readMethod());
console.log(derived.readAccessor());
console.log(derived.readData());
console.log(derived.readAbsent());
console.log(derived.readKey("method") === Base.prototype.method, derived.readKey("accessor"));
derived.writeAccessor(1);
console.log(derived.writeOwn(2));
console.log(derived.writeKey("byKey", 3));
attempt("class write to read-only", () => derived.writeReadOnly());
console.log(Derived.readStatic());
console.log(Derived.readStaticAccessor());
console.log(Derived.readStaticKey("staticAccessor"));
Derived.writeStaticAccessor(4);

function sloppyLiteral(parent) {
  return {
    __proto__: parent,
    label: "literal",
    read() {
      return super.value;
    },
    readKey(key) {
      return super[key];
    },
    write(value) {
      super.value = value;
      return Object.hasOwn(this, "value") ? this.value : "not own";
    },
    writeKey(key, value) {
      super[key] = value;
      return Object.hasOwn(this, key) ? this[key] : "not own";
    },
  };
}

function strictLiteral(parent) {
  "use strict";
  return {
    __proto__: parent,
    write(value) {
      super.value = value;
      return Object.hasOwn(this, "value") ? this.value : "not own";
    },
    writeKey(key, value) {
      super[key] = value;
      return Object.hasOwn(this, key) ? this[key] : "not own";
    },
  };
}

const accessorParent = {
  get value() {
    return `getter on ${this.label}`;
  },
  set value(stored) {
    console.log(`setter on ${this.label} with ${stored}`);
  },
};
const literal = sloppyLiteral(accessorParent);
console.log(literal.read(), literal.readKey("value"));
console.log(literal.write(1), literal.writeKey("value", 2));

const readOnlyParent = Object.defineProperty({}, "value", { value: "fixed", writable: false });
attempt("sloppy write to read-only", () => sloppyLiteral(readOnlyParent).write(1));
attempt("sloppy keyed write to read-only", () => sloppyLiteral(readOnlyParent).writeKey("value", 1));
attempt("strict write to read-only", () => strictLiteral(readOnlyParent).write(1));
attempt("strict keyed write to read-only", () => strictLiteral(readOnlyParent).writeKey("value", 1));

const getterOnlyParent = {
  get value() {
    return "getter only";
  },
};
attempt("sloppy write to getter only", () => sloppyLiteral(getterOnlyParent).write(1));
attempt("strict write to getter only", () => strictLiteral(getterOnlyParent).write(1));

const first = { value: "first parent" };
const second = { value: "second parent" };
const moved = sloppyLiteral(first);
console.log(moved.read(), moved.readKey("value"));
Object.setPrototypeOf(moved, second);
console.log(moved.read(), moved.readKey("value"));
Object.setPrototypeOf(moved, null);
attempt("read of null parent", () => moved.read());
attempt("keyed read of null parent", () => moved.readKey("value"));
attempt("write to null parent", () => moved.write(1));

class Other {
  method() {
    return "Other.method";
  }
  get accessor() {
    return `other getter on ${this.label}`;
  }
}
class Moving extends Base {
  read() {
    return super.method();
  }
  readAccessor() {
    return super.accessor;
  }
}
const moving = new Moving("moving");
const warmedUp = [];
for (let i = 0; i < 100; i++) {
  warmedUp.push(moving.read());
  warmedUp.push(moving.readAccessor());
}
console.log(new Set(warmedUp).size, warmedUp[0], warmedUp[1]);
Object.setPrototypeOf(Moving.prototype, Other.prototype);
console.log(moving.read(), moving.readAccessor());
Other.prototype.method = () => "replaced method";
console.log(moving.read());
Object.setPrototypeOf(Moving.prototype, null);
attempt("class read of null parent", () => moving.read());

class Stable extends Base {
  read() {
    return super.data;
  }
}
const stable = new Stable("stable");
let stableReads = 0;
for (let i = 0; i < 100; i++) {
  if (stable.read() === "inherited data") stableReads++;
}
console.log(stableReads);
Base.prototype.data = "changed data";
console.log(stable.read());
