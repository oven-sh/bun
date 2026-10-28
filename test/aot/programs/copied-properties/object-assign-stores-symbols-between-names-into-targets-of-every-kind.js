// Object.assign stores objects that hold symbols between names into targets of every kind: literals, instances, objects with and below accessors, read-only properties and frozen objects, functions, arrays; each target is printed.
function pick(name) {
  return Symbol[name];
}
const first = pick("asyncDispose");
const second = pick("iterator");
const known = Symbol("known");
function source() {
  return { [first]: 1, size: 2, [second]: 3, count: 4 };
}
function knownSource() {
  return { [known]: 1, size: 2 };
}
function show(label, make) {
  console.log(label, make(source()));
  console.log(label, "known", make(knownSource()));
  console.log(label, "two", make(source(), knownSource()));
  console.log(label, "three", make({ before: 0 }, source(), { after: 5 }));
}
class Plain {
  constructor(...from) {
    Object.assign(this, ...from);
  }
}
class Below extends Plain {}
class WithField extends Plain {
  size = 0;
}
class WithGetter extends Plain {
  get twice() {
    return 2;
  }
}
class WithSetters {
  seen = [];
  constructor(...from) {
    Object.assign(this, ...from);
  }
  set size(value) {
    this.seen.push("size");
  }
  set [first](value) {
    this.seen.push("symbol");
  }
  set [known](value) {
    this.seen.push("known");
  }
}
show("an empty literal", (...from) => Object.assign({}, ...from));
show("a literal", (...from) => Object.assign({ count: 0, own: 1 }, ...from));
show("a literal with a symbol", (...from) => Object.assign({ [second]: 0, own: 1 }, ...from));
show("an instance", (...from) => new Plain(...from));
show("an instance of a class below", (...from) => new Below(...from));
show("an instance with a field", (...from) => new WithField(...from));
show("an instance of a class with a getter", (...from) => new WithGetter(...from));
show("an instance of a class with setters", (...from) => new WithSetters(...from));
show("a read-only property", (...from) =>
  Object.assign(Object.defineProperty({}, "fixed", { value: 1, enumerable: true }), ...from),
);
show("a hidden property", (...from) =>
  Object.assign(Object.defineProperty({}, "hidden", { value: 1, writable: true, configurable: true }), ...from),
);
show("an accessor", (...from) =>
  Object.assign(
    {
      get other() {
        return 1;
      },
    },
    ...from,
  ),
);
show("below a literal", (...from) => Object.assign(Object.create({ other: 1 }), ...from));
show("below an accessor", (...from) =>
  Object.assign(
    Object.create({
      get other() {
        return 1;
      },
    }),
    ...from,
  ),
);
show("below a frozen literal", (...from) => Object.assign(Object.create(Object.freeze({ other: 1 })), ...from));
show("below two literals", (...from) => Object.assign(Object.create(Object.create({ other: 1 })), ...from));
show("below an instance", (...from) => Object.assign(Object.create(new Plain({ other: 1 })), ...from));
show("below an instance of a class with a getter", (...from) =>
  Object.assign(Object.create(new WithGetter({ other: 1 })), ...from),
);
show("below nothing", (...from) => Object.assign(Object.create(null), ...from));
show("a function", (...from) => Object.assign(function target() {}, ...from));
show("an array", (...from) => Object.assign([], ...from));
show("a sealed literal with the names", (...from) => {
  try {
    return Object.assign(
      Object.seal({ [first]: 0, size: 0, [second]: 0, count: 0, [known]: 0, before: 0, after: 0 }),
      ...from,
    );
  } catch (error) {
    return error.constructor.name;
  }
});
show("a literal that takes no more", (...from) => {
  const target = Object.preventExtensions({ size: 0 });
  try {
    Object.assign(target, ...from);
  } catch (error) {
    console.log(error.constructor.name);
  }
  return target;
});
class Body {
  [known] = 0;
  label = "";
  constructor(mass, label) {
    this[known] = mass;
    this.label = label;
  }
  describe() {
    return this[known] + this.label;
  }
}
const onto = Object.assign(new Body(9, "zzzz"), new Body(3, "ccc"));
console.log("an instance onto an instance", onto, onto.describe());
const again = Object.assign(new Body(8, "yyy"), new Body(4, "dd"));
console.log("an instance onto an instance, again", again, again.describe());
