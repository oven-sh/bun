// What a callee's read or store finds above an object depends on the chain at that moment. The chain changes: Object.setPrototypeOf, Reflect.setPrototypeOf, __proto__ by name and by a computed key, the prototype property of a constructor function, the link of a class's prototype object, another new.target, a Proxy anywhere above.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag).join("+") || "nobody";
const spy = {
  get color() {
    kept.push(this);
    return "spied";
  },
  set color(value) {
    kept.push(this);
  },
};
const trap = new Proxy(
  {},
  {
    get(target, key, receiver) {
      if (key === "color") kept.push(receiver);
      return key === "color" ? "trapped" : undefined;
    },
    set(target, key, value, receiver) {
      if (key !== "color") return Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true });
      kept.push(receiver);
      return true;
    },
    has() {
      return false;
    },
  },
);
const readColor = thing => thing.color;
const paint = (thing, color) => {
  thing.color = color;
  return thing.color;
};
const lines = [];
function step(what, run) {
  lines.push(what + " " + run());
  churn(20);
  lines.push(report());
}
const link = ["__pro", "to__"].join("");
for (const above of [spy, trap]) {
  const name = above === spy ? "spy" : "trap";
  step(name + " untouched", () => readColor({ tag: "untouched" }) + "," + paint({ tag: "untouched" }, "red"));
  step(name + " setPrototypeOf", () => readColor(Object.setPrototypeOf({ tag: "setPrototypeOf" }, above)));
  step(name + " Reflect", () => {
    const thing = { tag: "Reflect" };
    Reflect.setPrototypeOf(thing, above);
    return paint(thing, "red");
  });
  step(name + " by name", () => {
    const thing = { tag: "by name" };
    thing.__proto__ = above;
    return readColor(thing);
  });
  step(name + " by key", () => {
    const thing = { tag: "by key" };
    thing[link] = above;
    return paint(thing, "red");
  });
  step(name + " two steps up", () => readColor({ __proto__: { __proto__: above }, tag: "two steps up" }));
}
// The callee itself swaps the chain between two reads.
function swapAndRead(thing, key, above) {
  const before = thing.color;
  thing[key] = above;
  return before + "," + thing.color;
}
step("swapped by the callee", () => swapAndRead({ tag: "swapped by the callee" }, link, spy));
step("not swapped by the callee", () => swapAndRead({ tag: "not swapped by the callee" }, "other", spy));
// Constructor functions and classes.
function Old(tag) {
  this.tag = tag;
}
step("Old", () => readColor(new Old("Old")));
Old.prototype = spy;
step("Old below the spy", () => readColor(new Old("Old below the spy")));
Old.prototype = trap;
step("Old below the trap", () => paint(new Old("Old below the trap"), "red"));
class Plain {
  constructor(tag) {
    this.tag = tag;
  }
}
step("Plain", () => readColor(new Plain("Plain")));
step("another new.target", () => readColor(Reflect.construct(Plain, ["another new.target"], Old)));
function Other() {}
Other.prototype = spy;
step("yet another new.target", () => paint(Reflect.construct(Plain, ["yet another new.target"], Other), "red"));
Object.setPrototypeOf(Plain.prototype, spy);
step("Plain relinked", () => readColor(new Plain("Plain relinked")));
Object.setPrototypeOf(Plain.prototype, trap);
step("Plain relinked again", () => paint(new Plain("Plain relinked again"), "red"));
Object.setPrototypeOf(Plain.prototype, Object.prototype);
step("Plain as before", () => readColor(new Plain("Plain as before")) + "," + paint(new Plain("Plain as before"), "red"));
Object.defineProperty(Plain.prototype, "color", Object.getOwnPropertyDescriptor(spy, "color"));
step("Plain with an accessor", () => readColor(new Plain("Plain with an accessor")));
console.log(lines.join("\n"));
