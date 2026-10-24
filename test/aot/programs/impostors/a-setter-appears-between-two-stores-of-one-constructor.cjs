const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function ByMember(first, holder) {
  this.first = first;
  this.second = holder.value;
  this.third = 3;
}

function ByArithmetic(first, number) {
  this.first = first;
  this.second = number * 2;
  this.third = 3;
}

function ByText(first, text) {
  this.first = first;
  this.second = "" + text;
  this.third = 3;
}

function ByCall(first, callback) {
  this.first = first;
  this.second = callback();
  this.third = 3;
}

function ByComparison(first, other) {
  this.first = first;
  this.second = other < 5;
  this.third = 3;
}

function ByKey(first, key) {
  this.first = first;
  this.second = { value: "found" }[key];
  this.third = 3;
}

class ClassByMember {
  constructor(first, holder) {
    this.first = first;
    this.second = holder.value;
    this.third = 3;
  }
}

class ClassByArithmetic {
  constructor(first, number) {
    this.first = first;
    this.second = number * 2;
    this.third = 3;
  }
}

class ClassWithFields {
  first = 1;
  second = ClassWithFields.hook();
  third = 3;
  static hook() {
    return 2;
  }
}

function plant(prototype, name) {
  Object.defineProperty(prototype, name, {
    get() {
      return "from the planted getter";
    },
    set(value) {
      log.push("planted setter of " + name + " got " + String(value));
    },
    configurable: true,
  });
}

const makers = [
  [ByMember, strike => ({ get value() { strike(); return 2; } }), { value: 2 }],
  [ByArithmetic, strike => ({ valueOf() { strike(); return 1; } }), 1],
  [ByText, strike => ({ toString() { strike(); return "2"; } }), "2"],
  [ByCall, strike => () => (strike(), 2), () => 2],
  [ByComparison, strike => ({ valueOf() { strike(); return 1; } }), 1],
  [ByKey, strike => ({ toString() { strike(); return "value"; } }), "value"],
  [ClassByMember, strike => ({ get value() { strike(); return 2; } }), { value: 2 }],
  [ClassByArithmetic, strike => ({ valueOf() { strike(); return 1; } }), 1],
];

for (const [Maker, arm, honest] of makers) {
  for (let i = 0; i < 2000; i++) new Maker(1, honest);
  console.log(Maker.name + " | honest -> " + show(new Maker(1, honest)));
  for (const name of ["first", "second", "third"]) {
    const made = new Maker(1, arm(() => plant(Maker.prototype, name)));
    console.log(Maker.name + " | a setter for " + name + " is planted while second is computed -> " + show(made) + " | " + name + " reads " + show(made[name]) + " | log " + log.splice(0).join(", "));
    const next = new Maker(1, honest);
    console.log(Maker.name + " | the next honest construction -> " + show(next) + " | log " + log.splice(0).join(", "));
    delete Maker.prototype[name];
    console.log(Maker.name + " | after the setter was removed -> " + show(new Maker(1, honest)) + " | the struck one reads " + show(made[name]));
  }
  const frozen = [];
  try {
    frozen.push(show(new Maker(1, arm(function () { Object.defineProperty(Maker.prototype, "third", { value: "fixed", writable: false, configurable: true }); }))));
  } catch (error) {
    frozen.push("threw " + error.constructor.name);
  }
  delete Maker.prototype.third;
  console.log(Maker.name + " | a read-only third is planted while second is computed -> " + frozen[0]);
}

for (let i = 0; i < 2000; i++) new ClassWithFields();
console.log("ClassWithFields | honest -> " + show(new ClassWithFields()));
ClassWithFields.hook = function () {
  plant(ClassWithFields.prototype, "third");
  return 2;
};
console.log("ClassWithFields | a setter for third is planted by an initializer -> " + show(new ClassWithFields()) + " | log " + log.splice(0).join(", "));
delete ClassWithFields.prototype.third;
