// One helper gives every function object its name. The function objects come out of Object.getOwnPropertyDescriptors: getters, setters and methods,
// under names, symbols and indexes, of literals, of the prototype of a class and of objects that took all the descriptors of another.
// Each frame shows the name of its own function object. The last lines print what the descriptors themselves hold.
const top = stack =>
  String(stack)
    .split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .slice(0, 2)
    .map(line => line.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
const rename = (f, n) => Object.defineProperty(f, "name", { value: n });
const key = Symbol("key");
// The descriptors of another object go where nobody follows them.
new CustomEvent("x", { detail: Object.getOwnPropertyDescriptors({ p: 1 }) });

const roads = {
  getter(n) {
    return rename(
      Object.getOwnPropertyDescriptors({
        get g() {
          return new Error("x").stack;
        },
      }).g.get,
      n,
    );
  },
  setter(n) {
    let stack;
    const set = Object.getOwnPropertyDescriptors({
      set s(value) {
        stack = new Error("x").stack;
      },
    }).s.set;
    rename(set, n);
    return () => (set(1), stack);
  },
  method(n) {
    return rename(
      Object.getOwnPropertyDescriptors({
        m() {
          return new Error("x").stack;
        },
      }).m.value,
      n,
    );
  },
  underSymbol(n) {
    return rename(
      Object.getOwnPropertyDescriptors({
        get [key]() {
          return new Error("x").stack;
        },
      })[key].get,
      n,
    );
  },
  underIndex(n) {
    return rename(Object.getOwnPropertyDescriptors([() => new Error("x").stack])[0].value, n);
  },
  ofPrototype(n) {
    class K {
      get g() {
        return new Error("x").stack;
      }
    }
    return rename(Object.getOwnPropertyDescriptors(K.prototype).g.get, n);
  },
  definedOnAnother(n) {
    const target = Object.defineProperties(
      {},
      Object.getOwnPropertyDescriptors({
        get g() {
          return new Error("x").stack;
        },
      }),
    );
    return rename(Object.getOwnPropertyDescriptors(target).g.get, n);
  },
  createdWith(n) {
    const target = Object.create(
      null,
      Object.getOwnPropertyDescriptors({
        m() {
          return new Error("x").stack;
        },
      }),
    );
    return rename(target.m, n);
  },
  walked(n) {
    const all = Object.getOwnPropertyDescriptors({
      get g() {
        return new Error("x").stack;
      },
    });
    for (const descriptor of Object.values(all)) return rename(descriptor.get, n);
  },
};
for (const road in roads) {
  const a = roads[road]("a1"),
    b = roads[road]("b1");
  console.log(road, top(a()), "/", top(b()), "/", top(a.call(null)), "/", top(Reflect.apply(b, null, [])));
}

const described = Object.getOwnPropertyDescriptors({
  a: 1,
  get b() {
    return 2;
  },
  [key]: "three",
  4: [5],
});
console.log(Reflect.ownKeys(described).map(String).join(), Object.getPrototypeOf(described) === Object.prototype);
console.log(
  JSON.stringify(described),
  typeof described.b.get,
  described.b.get(),
  described.b.set,
  described[key].value,
);
console.log("missing" in described, described.missing, described[4].value[0] + 1, Object.keys(described.a).join());
described.a.value = "written";
described.later = { value: 6 };
console.log(described.a.value, Object.defineProperties({}, described).later, Object.isFrozen(described));
console.log(
  JSON.stringify(Object.getOwnPropertyDescriptors("ab")),
  JSON.stringify(Object.getOwnPropertyDescriptors(7)),
);

const seen = [];
const throughTraps = Object.getOwnPropertyDescriptors(
  new Proxy(
    { a: 1, b: 2 },
    {
      ownKeys(target) {
        seen.push("ownKeys");
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, name) {
        seen.push("describe " + String(name));
        return name === "b" ? undefined : Reflect.getOwnPropertyDescriptor(target, name);
      },
    },
  ),
);
console.log(seen.join(), JSON.stringify(throughTraps));
for (const refused of [null, undefined]) {
  try {
    Object.getOwnPropertyDescriptors(refused);
  } catch (error) {
    console.log(error.constructor === TypeError);
  }
}
try {
  Object.getOwnPropertyDescriptors(
    new Proxy(
      {},
      {
        ownKeys() {
          throw new RangeError("thrown by the trap");
        },
      },
    ),
  );
} catch (error) {
  console.log(error.name, error.message);
}
