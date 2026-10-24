function listOwn(object) {
  const lines = [];
  for (const key in object) lines.push(key + ":" + object.hasOwnProperty(key));
  return lines.join(" ");
}

function listHasOwn(object) {
  const lines = [];
  for (const key in object) lines.push(key + ":" + Object.hasOwn(object, key));
  return lines.join(" ");
}

function listIn(object) {
  const lines = [];
  for (const key in object) lines.push(key + ":" + (key in object));
  return lines.join(" ");
}

function listValues(object) {
  const lines = [];
  for (const key in object) lines.push(key + "=" + object[key]);
  return lines.join(" ");
}

function listOwnOfOther(object, other) {
  const lines = [];
  for (const key in object) lines.push(key + ":" + Object.hasOwn(other, key) + ":" + (key in other) + ":" + other[key]);
  return lines.join(" ");
}

function listWhileDeleting(object, victim) {
  const lines = [];
  for (const key in object) {
    delete object[victim];
    lines.push(key + ":" + Object.hasOwn(object, key) + ":" + (key in object) + ":" + object[key]);
  }
  return lines.join(" ");
}

function listWhileAdding(object) {
  const lines = [];
  for (const key in object) {
    object["added" + key] = 1;
    lines.push(key + ":" + Object.hasOwn(object, key) + ":" + object[key]);
  }
  return lines.join(" ") + " | " + Object.keys(object).join();
}

function listWhileRedefining(object, victim) {
  const lines = [];
  let reads = 0;
  for (const key in object) {
    Object.defineProperty(object, victim, {
      get() {
        reads++;
        return "got";
      },
      configurable: true,
      enumerable: true,
    });
    lines.push(key + ":" + Object.hasOwn(object, key) + ":" + object[key]);
  }
  return lines.join(" ") + " reads " + reads;
}

function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

const uses = { listOwn, listHasOwn, listIn, listValues };
for (let i = 0; i < 2000; i++) for (const use of Object.values(uses)) use({ a: i, b: 2, c: 3 });

function Parent() {
  this.own = 1;
}
Parent.prototype.inherited = 2;

class Base {
  constructor() {
    this.field = 1;
  }
}
Base.prototype.shared = "s";

const subjects = {
  honest: () => ({ a: 1, b: 2, c: 3 }),
  "an inherited key": () => Object.create({ up: 1 }, { down: { value: 2, enumerable: true } }),
  "an own key that hides an inherited one": () => Object.assign(Object.create({ both: "up", up: 1 }), { both: "down" }),
  "a constructor function's instance": () => new Parent(),
  "a class instance with a key on the prototype": () => new Base(),
  "index keys and names": () => ({ b: 1, 1: "one", a: 2, 0: "zero" }),
  "an array with a name": () => Object.assign([7, 8], { name: "n" }),
  "a string object": () => new String("hi"),
  "no prototype": () => Object.assign(Object.create(null), { a: 1 }),
  "its own hasOwnProperty": () => ({ a: 1, hasOwnProperty: () => "mine" }),
  "a proxy that hides what it lists": () =>
    new Proxy(
      { a: 1, b: 2 },
      {
        has: () => false,
        getOwnPropertyDescriptor: (target, key) =>
          key === "b" ? undefined : Reflect.getOwnPropertyDescriptor(target, key),
      },
    ),
  "a getter that deletes the next key": () => {
    const object = {
      get first() {
        delete object.second;
        return 1;
      },
      second: 2,
      third: 3,
    };
    return object;
  },
};

for (const [name, make] of Object.entries(subjects))
  for (const [use, run] of Object.entries(uses)) attempt(name + ", " + use + ":", () => run(make()));

attempt("another object of the same shape:", () => listOwnOfOther({ a: 1, b: 2 }, { a: 3, b: 4 }));
attempt("another object that lacks a key:", () => listOwnOfOther({ a: 1, b: 2 }, { a: 3 }));
attempt("another object that inherits a key:", () => listOwnOfOther({ a: 1, b: 2 }, Object.create({ a: 5, b: 6 })));
attempt("another object in another order:", () => listOwnOfOther({ a: 1, b: 2 }, { b: 4, a: 3 }));
attempt("a primitive as the other:", () => listOwnOfOther({ length: 1, b: 2 }, "xyz"));
attempt("the key just visited is deleted:", () => listWhileDeleting({ a: 1, b: 2, c: 3 }, "a"));
attempt("a key still to come is deleted:", () => listWhileDeleting({ a: 1, b: 2, c: 3 }, "c"));
attempt("a deleted key shows an inherited one:", () =>
  listWhileDeleting(Object.assign(Object.create({ b: "up" }), { a: 1, b: 2, c: 3 }), "b"),
);
attempt("keys are added:", () => listWhileAdding({ a: 1, b: 2 }));
attempt("a key becomes a getter:", () => listWhileRedefining({ a: 1, b: 2, c: 3 }, "b"));
for (const [use, run] of Object.entries(uses)) attempt("honest again, " + use + ":", () => run({ a: 1, b: 2, c: 3 }));
