// Prints the name of function objects, and what the first stack frame calls them, after their names were read, redefined, deleted, and after a displayName was given to one of two function objects of one function.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
function nameOf(g) {
  return g.name;
}
for (let i = 0; i < 64; i++) nameOf(() => i);

const makers = {
  "a function expression": n =>
    function made() {
      return new Error("x" + n).stack;
    },
  "an arrow function": n => {
    let made;
    made = () => new Error("x" + n).stack;
    return made;
  },
  "a method": n =>
    ({
      made() {
        return new Error("x" + n).stack;
      },
    }).made,
  "a function without a name": n =>
    function () {
      return new Error("x" + n).stack;
    },
  "a function without captures": () =>
    function made() {
      return new Error("x").stack;
    },
  "a function under a computed key": n =>
    ({
      ["ma" + "de" + never]: function () {
        return new Error("x" + n).stack;
      },
    }).made,
};
const display = f => void (handedBack(f).displayName = "displayed");
const steps = {
  "read, displayed": (a, b) => [nameOf(a), display(a)],
  "displayed, read": (a, b) => [display(a), nameOf(a)],
  "read, the other displayed": (a, b) => [nameOf(a), display(b)],
  "displayed": (a, b) => [display(a)],
  "both read, one displayed": (a, b) => [nameOf(a), nameOf(b), display(b)],
  "read, collected, displayed": (a, b) => [nameOf(a), void Bun.gc(true), display(a)],
  "read, defined": (a, b) => [nameOf(a), Object.defineProperty(a, "name", { value: "defined" }) === a],
  "defined, read": (a, b) => [Object.defineProperty(a, "name", { value: "defined" }) === a, nameOf(a)],
  "read, defined as it is, displayed": (a, b) => [
    nameOf(a),
    Object.defineProperty(a, "name", { value: nameOf(b) }) === a,
    display(a),
  ],
  "read, defined, displayed": (a, b) => [
    nameOf(a),
    Object.defineProperty(a, "name", { value: "defined" }) === a,
    display(a),
  ],
  "read, deleted": (a, b) => [nameOf(a), delete a.name],
  "deleted, read": (a, b) => [delete a.name, nameOf(a)],
  "read, deleted, displayed": (a, b) => [nameOf(a), delete a.name, display(a)],
  "read, a getter defined": (a, b) => [nameOf(a), Object.defineProperty(a, "name", { get: () => "got" }) === a],
  "read, a property added, displayed": (a, b) => [nameOf(a), (a.extra = 1), display(a)],
  "a property added, read, displayed": (a, b) => [(a.extra = 1), nameOf(a), display(a)],
  "a property added, displayed": (a, b) => [(a.extra = 1), display(a)],
  "read, frozen, displayed": (a, b) => [
    nameOf(a),
    Object.isFrozen(Object.freeze(a)),
    Reflect.set(handedBack(a), "displayName", "displayed"),
  ],
  "read, keys listed": (a, b) => [nameOf(a), Reflect.ownKeys(a).join()],
  "read, described": (a, b) => [nameOf(a), JSON.stringify(Object.getOwnPropertyDescriptor(a, "name"))],
  "read, another prototype, displayed": (a, b) => [
    nameOf(a),
    Object.setPrototypeOf(a, { name: "above" }) === a,
    display(a),
  ],
  "deleted below another prototype": (a, b) => [
    nameOf(a),
    Object.setPrototypeOf(a, { name: "above" }) === a,
    delete a.name,
  ],
  "asked for with in, displayed": (a, b) => ["name" in a, display(a)],
  "asked for with hasOwn, displayed": (a, b) => [Object.hasOwn(a, "name"), display(a)],
  "read with Reflect.get, displayed": (a, b) => [Reflect.get(a, "name"), display(a)],
  "read by a pattern, displayed": (a, b) => [(({ name }) => name)(a), display(a)],
  "read under a key, displayed": (a, b) => [a["na" + "me" + never], display(a)],
  "length read, displayed": (a, b) => [a.length, display(a)],
  "prototype read, displayed": (a, b) => [typeof a.prototype, display(a)],
  "read, prototype read, displayed": (a, b) => [nameOf(a), typeof a.prototype, display(a)],
  "read, displayName stored here": (a, b) => [nameOf(a), (a.displayName = "stored")],
  "displayName stored here": (a, b) => [(a.displayName = "stored")],
};
const stepsThatBind = {
  "read, bound": (a, b) => [nameOf(a), nameOf(a.bind(null)), nameOf(a.bind(null).bind(null))],
  "displayed, bound": (a, b) => [display(a), nameOf(a.bind(null))],
  "defined, bound": (a, b) => [Object.defineProperty(a, "name", { value: "defined" }) === a, nameOf(a.bind(null))],
};
for (const [maker, make] of Object.entries(makers)) {
  for (const [step, run] of Object.entries(maker.includes("computed") ? steps : { ...steps, ...stepsThatBind })) {
    for (let round = 0; round < 3; round++) {
      const a = make(1);
      const b = make(2);
      const said = run(a, b);
      const line = [
        said.join(" "),
        firstFrame(a()),
        firstFrame(b()),
        nameOf(a),
        nameOf(b),
        Object.hasOwn(a, "name"),
        Object.hasOwn(b, "name"),
      ].join(" | ");
      if (round === 2) console.log(maker + ", " + step + ": " + line);
    }
  }
}

for (let round = 0; round < 3; round++) {
  class WithMethod {
    static name() {
      return round;
    }
  }
  class WithField {
    static name = "field" + round;
  }
  class Plain {}
  const anonymous = class {};
  console.log(
    "classes:",
    typeof nameOf(WithMethod),
    nameOf(WithField),
    nameOf(Plain),
    nameOf(anonymous),
    nameOf(class {}),
    nameOf(class extends Plain {}),
  );
}

{
  const round = Number(never);
  const holder = {
    get made() {
      return new Error("x" + round).stack;
    },
    set made(value) {
      this.stack = new Error("x" + value).stack;
    },
  };
  const { get, set } = Object.getOwnPropertyDescriptor(holder, "made");
  handedBack(get);
  handedBack(set);
  const before = [firstFrame(holder.made), ((holder.made = 1), firstFrame(holder.stack))];
  console.log(
    "accessors:",
    before.join(" | "),
    nameOf(get),
    nameOf(set),
    firstFrame(holder.made),
    ((holder.made = 1), firstFrame(holder.stack)),
  );
}

for (let round = 0; round < 3; round++) {
  const inside = function made() {
    const read = round ? nameOf(inside) : "";
    handedBack(inside).displayName = "displayed";
    return read + " " + firstFrame(new Error("x" + round).stack);
  };
  console.log("from inside:", inside(), "|", inside());
}

const named = [
  async () => {},
  async function made() {},
  function* made() {},
  async function* made() {},
  Symbol,
  Math.max,
  handedBack,
  new Proxy(function target() {}, {}),
  nameOf,
  nameOf.bind(null),
];
console.log("others:", named.map(nameOf).join(" | "));
