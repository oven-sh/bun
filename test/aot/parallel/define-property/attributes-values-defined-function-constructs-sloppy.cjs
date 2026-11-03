// What a constructor that only hands `this` on makes: the attributes of what is defined on it hold exactly.
const lines = [];
const show = (label, value) => lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
const attempt = (label, action) => {
  try {
    show(label, action());
  } catch (error) {
    show(label, error.constructor.name + " " + error.message);
  }
};
function describe(label, object) {
  show(label + " keys", Object.keys(object));
  show(label + " names", Object.getOwnPropertyNames(object));
  show(label + " own", Reflect.ownKeys(object).map(String));
  const walked = [];
  for (const key in object) walked.push(key);
  show(label + " for-in", walked);
  show(label + " entries", Object.entries(object));
  show(label + " json", JSON.stringify(object));
  show(label + " spread", { ...object });
  show(label + " assign", Object.assign({}, object));
  show(label + " descriptors", Object.getOwnPropertyDescriptors(object));
}
function makeKind(label, fill) {
  function Kind(options) {
    Object.defineProperty(this, "hidden", { value: { options, label }, enumerable: false });
    fill(this, options);
  }
  return Kind;
}
const Fixed = makeKind("fixed", (self, options) => {
  self.a = options.a;
  Object.defineProperty(self, "quiet", { value: options.a * 2, writable: true, configurable: true });
  Object.defineProperty(self, "loud", { value: options.a * 3, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(self, "stuck", { value: options.a * 4, enumerable: true });
  self.b = options.a + 1;
});
function strictly(object) {
  "use strict";
  attempt("strict store hidden", () => ((object.hidden = 1), object.hidden));
  attempt("strict store stuck", () => ((object.stuck = 1), object.stuck));
  attempt("strict store quiet", () => ((object.quiet = 7), object.quiet));
  attempt("strict delete hidden", () => delete object.hidden);
  attempt("strict delete stuck", () => delete object.stuck);
  attempt("strict delete quiet", () => delete object.quiet);
}
for (let turn = 0; turn < 3; turn++) {
  const made = new Fixed({ a: turn + 1 });
  describe("made " + turn, made);
  made.hidden = 5;
  made.stuck = 6;
  made.quiet += 1;
  made.loud += 1;
  show("after sloppy stores", [made.hidden.label, made.stuck, made.quiet, made.loud]);
  show("sloppy delete", [delete made.hidden, delete made.stuck, delete made.loud]);
  describe("after deletes " + turn, made);
  strictly(made);
  describe("after strict " + turn, made);
  attempt("define hidden again, same", () => Object.defineProperty(made, "hidden", { value: made.hidden }) === made);
  attempt("define hidden again, other", () => Object.defineProperty(made, "hidden", { value: 1 }) === made);
  attempt("define hidden enumerable", () => Object.defineProperty(made, "hidden", { enumerable: true }) === made);
  attempt("reflect define hidden", () => Reflect.defineProperty(made, "hidden", { value: 2 }));
  attempt("define quiet back", () => Object.defineProperty(made, "quiet", { value: 9, enumerable: true }).quiet);
  attempt("define a as getter", () => Object.defineProperty(made, "a", { get: () => "got", configurable: true }).a);
  attempt("define b read-only", () => ((Object.defineProperty(made, "b", { writable: false }).b = 100), made.b));
  describe("after definitions " + turn, made);
  show("has", ["hidden" in made, Object.hasOwn(made, "hidden"), made.propertyIsEnumerable("hidden"), made.propertyIsEnumerable("stuck"), made.hasOwnProperty("quiet")]);
  Object.freeze(made);
  show("frozen", [Object.isFrozen(made), Object.isSealed(made), Object.isExtensible(made)]);
  describe("frozen " + turn, made);
}
console.log(lines.join("\n"));
