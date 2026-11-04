const opaque = value => new CustomEvent("opaque", { detail: value }).detail; // the compiler can't see through a value returned by native code
const decoded = text => Buffer.from(text).toString(); // or a string decoded at run time
function show(value) {
  if (typeof value === "function") return "function";
  if (typeof value === "object" && value !== null) return Object.prototype.toString.call(value);
  return typeof value + " " + String(value);
}
function attempt(label, action) {
  let outcome;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = error.name;
  }
  console.log(label + ": " + outcome);
}
function Old() {}
Old.version = 1;
Old.create = function () {
  return new Old();
};
Old.prototype.greet = function () {
  return "old";
};
function Newer() {}
Newer.version = 2;
Newer.create = function () {
  return new Newer();
};
Newer.prototype.greet = function () {
  return "newer";
};
function versionOf(constructor) {
  return constructor.version;
}
function created(constructor) {
  return constructor.create().greet() + " " + (constructor.create() instanceof constructor);
}
function prototypeOf(constructor) {
  return constructor.prototype === Object.getPrototypeOf(new constructor());
}
function showAll(when) {
  for (const constructor of [Old, Newer])
    attempt(when + ", " + constructor.name, () =>
      [versionOf(constructor), created(constructor), prototypeOf(constructor)].join(" | "),
    );
}
showAll("as created");
showAll("as created, again");
Old.version = "one";
showAll("the version is a string");
delete Old.version;
showAll("the version deleted");
Object.defineProperty(Newer, "version", {
  get() {
    return "computed";
  },
  configurable: true,
});
showAll("the version is a getter");
Old.create = Newer.create;
showAll("create replaced");
Old.prototype = {
  greet() {
    return "a different prototype";
  },
};
Old.create = function () {
  return new Old();
};
showAll("a different prototype property");
