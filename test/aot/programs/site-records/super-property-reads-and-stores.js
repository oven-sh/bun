// `super.field` reads from the chain above the home object with `this` as the receiver; `super.field = value` asks that chain for a setter and otherwise stores on `this`. In classes and in object literals, while the chain changes.
const trail = [];

class Below {
  get level() {
    return "Below.level of " + this.id;
  }
  set level(value) {
    trail.push("Below.level = " + value + " on " + this.id);
  }
}
Below.prototype.plain = "plain on Below.prototype";

class Above extends Below {
  id = "above";
  readLevel() {
    return super.level;
  }
  storeLevel(value) {
    super.level = value;
  }
  readPlain() {
    return super.plain;
  }
  storePlain(value) {
    super.plain = value;
  }
  readMissing() {
    return super.missing;
  }
  updatePlain() {
    return (super.plain += "+");
  }
}

function attempt(run) {
  try {
    return String(run());
  } catch (error) {
    return "throws " + error.constructor.name;
  }
}
function look(mark, above) {
  console.log(mark + ":", attempt(() => above.readLevel()), "|", attempt(() => above.storeLevel("L")), "|", attempt(() => above.readPlain()), "|", attempt(() => above.storePlain("P")), "|", attempt(() => above.readPlain()), "|", attempt(() => above.plain), "|", attempt(() => above.updatePlain()), "|", attempt(() => above.plain), "|", attempt(() => above.readMissing()));
  console.log("  ", Object.keys(above).join(), trail.splice(0).join(";"));
}

look("at first", new Above());
look("again", new Above());
look("frozen", Object.freeze(new Above()));
Below.prototype.missing = "no longer missing";
look("the missing one appears", new Above());
delete Below.prototype.missing;
Object.defineProperty(Below.prototype, "plain", { value: "read-only", writable: false, configurable: true });
look("read-only above", new Above());
Object.defineProperty(Below.prototype, "plain", {
  get() {
    return "getter for " + this.id;
  },
  set(value) {
    trail.push("plain setter " + value);
  },
  configurable: true,
});
look("an accessor above", new Above());
delete Below.prototype.plain;
look("nothing above", new Above());
Object.setPrototypeOf(Above.prototype, { level: "level of a literal", plain: "plain of a literal" });
look("hung below a literal", new Above());
Object.setPrototypeOf(Above.prototype, Below.prototype);

const base = {
  who() {
    return "base.who";
  },
  value: "base.value",
};
const derived = {
  __proto__: base,
  id: "derived",
  who() {
    return "derived.who > " + super.who();
  },
  readValue() {
    return super.value;
  },
  storeValue(value) {
    super.value = value;
  },
};
console.log(derived.who(), derived.readValue(), attempt(() => derived.storeValue("stored")), derived.readValue(), derived.value, base.value, Object.keys(derived).join());
Object.setPrototypeOf(derived, { who: () => "elsewhere.who", value: "elsewhere.value" });
console.log(derived.who(), derived.readValue(), derived.value);
const heir = Object.create(derived);
heir.storeValue("on the heir");
console.log(heir.who(), heir.readValue(), heir.value, Object.keys(heir).join());

export {};
