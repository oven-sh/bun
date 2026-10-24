function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

console.log("strict code:", (function () { return this === undefined; })());

function Parcel(parcelWeight, parcelLabel) {
  this.parcelWeight = parcelWeight;
  this.parcelLabel = parcelLabel;
}
Parcel.prototype.heavy = function () {
  return this.parcelWeight > 10;
};

function Healing(healingValue) {
  if (!(this instanceof Healing)) return new Healing(healingValue);
  this.healingValue = healingValue;
}

function Guarded(guardedValue) {
  if (new.target === undefined) throw new SyntaxError("use new");
  this.guardedValue = guardedValue;
}

function build(Maker, first, second) {
  return new Maker(first, second);
}

function forget(Maker, first, second) {
  return Maker(first, second);
}

function readFreeNames() {
  return [typeof parcelWeight, typeof parcelLabel].join();
}

let heavy = 0;
for (let i = 0; i < 2000; i++) if (build(Parcel, i % 20, "label").heavy()) heavy++;
console.log("2000 honest constructions", heavy);

attempt("before: the global object has parcelWeight", () => "parcelWeight" in globalThis);
attempt("before: free names", readFreeNames);
attempt("Parcel(..) without new", () => Parcel(11, "direct"));
attempt("after: globalThis.parcelWeight", () => globalThis.parcelWeight);
attempt("after: globalThis.parcelLabel", () => globalThis.parcelLabel);
attempt("after: free names", readFreeNames);
attempt("after: the free name parcelWeight", () => parcelWeight);
attempt("after: its descriptor", () => Object.getOwnPropertyDescriptor(globalThis, "parcelWeight"));
attempt("through a parameter", () => forget(Parcel, 12, "parameter"));
attempt("after that: the free name parcelLabel", () => parcelLabel);
attempt("the method with the global object as this", () => Parcel.prototype.heavy.call(globalThis));
attempt("the method called bare", () => (0, Parcel.prototype.heavy)());
attempt("delete globalThis.parcelWeight", () => delete globalThis.parcelWeight);
attempt("delete globalThis.parcelLabel", () => delete globalThis.parcelLabel);
attempt("at the end: free names", readFreeNames);
attempt("at the end: the free name parcelWeight", () => parcelWeight);

attempt("a constructor that heals itself, with new", () => new Healing(1));
attempt("a constructor that heals itself, without", () => Healing(2));
attempt("without new it still makes an instance", () => Healing(3) instanceof Healing);
attempt("through a parameter", () => forget(Healing, 4));
attempt("with an instance as this it stores into it", () => {
  const instance = new Healing(5);
  return [Healing.call(instance, 6), instance.healingValue].join();
});
attempt("the global object got nothing", () => "healingValue" in globalThis);

attempt("a constructor that checks new.target, with new", () => new Guarded(1));
attempt("a constructor that checks new.target, without", () => Guarded(2));
attempt("through call with an instance", () => Guarded.call(new Guarded(3), 4));
attempt("through Reflect.construct", () => Reflect.construct(Guarded, [5]));

attempt("honest again", () => build(Parcel, 13, "again"));
attempt("a class called without new", () => forget(class Sealed {}, 1));
