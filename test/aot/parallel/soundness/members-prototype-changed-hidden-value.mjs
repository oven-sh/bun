// Error.prototype, Date.prototype and Function.prototype come back from native code, where the compiler cannot follow them. Members that can be replaced are stored, defined and deleted through that value, by name and under a key
// that only the run knows, and are read back through errors, dates and functions that the compiler knows. No statement names the object that it changes.
const hide = value => new CustomEvent("x", { detail: value }).detail;
const made = new RangeError("far");
const original = Error.prototype.toString;
function show(label) {
  console.log(label, "|", made.toString(), "|", String(new TypeError("fresh")), "|", `${new Error()}`);
}
function restore() {
  Object.defineProperty(hide(Error.prototype), "toString", {
    value: original,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
const named = text =>
  function () {
    return text + " " + this.name;
  };

show("at first");
hide(Error.prototype).toString = named("stored");
show("stored by name");
restore();
console.log(delete hide(Error.prototype).toString);
show("deleted by name");
restore();
Object.defineProperty(hide(Error.prototype), "toString", { get: () => named("got"), configurable: true });
show("defined as a getter");
restore();
hide(Error.prototype)[hide({ key: "toString" }).key] = named("under a key");
show("stored under a key that the run knows");
restore();
console.log(delete hide(Error.prototype)[hide({ key: "toString" }).key]);
show("deleted under a key that the run knows");
restore();
Object.assign(hide(Error.prototype), { toString: named("assigned") });
show("copied by Object.assign");
restore();
console.log(Reflect.set(hide(Error.prototype), "toString", named("set")));
show("stored by Reflect.set");
restore();
console.log(Reflect.deleteProperty(hide(Error.prototype), "toString"));
show("deleted by Reflect.deleteProperty");
restore();
console.log(
  Reflect.defineProperty(hide(Error.prototype), "toString", {
    value: named("defined"),
    writable: true,
    configurable: true,
  }),
);
show("defined by Reflect.defineProperty");
restore();
hide(new Error("hidden")).constructor.prototype.toString = named("through the constructor");
show("stored on the prototype of the constructor of a hidden error");
restore();
Object.getPrototypeOf(hide(new Error("hidden"))).toString = named("through the link");
show("stored on the prototype of a hidden error");
restore();
let caught;
try {
  null.member;
} catch (error) {
  caught = error;
}
Object.getPrototypeOf(Object.getPrototypeOf(caught)).toString = named("above");
show("stored two links above a caught error");
restore();
show("at last");

hide(Date.prototype).toString = () => "a date";
console.log(String(new Date(0)), new Date(0).toString(), new Date(0).getTime());
hide(Function.prototype).toString = () => "a function";
console.log(String(show), `${named}`, show.toString());
