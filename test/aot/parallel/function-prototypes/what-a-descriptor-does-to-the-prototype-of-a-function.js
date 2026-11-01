// Object.defineProperty(F, "prototype", ..) with each kind of descriptor: one that only makes it read-only, one with a value, with undefined as its value, one that lists it, one whose members come late, and an arrow function, which has no such property.
function show(label, F) {
  var made;
  try {
    made = new F();
  } catch (error) {
    made = error.name;
  }
  var descriptor = Object.getOwnPropertyDescriptor(F, "prototype");
  console.log(label, descriptor && typeof descriptor.value, descriptor && descriptor.writable, descriptor && descriptor.enumerable, Object.keys(F).join(), typeof made === "string" ? made : typeof made.who === "function" ? made.who() : "finds none", made instanceof Object && Object.getPrototypeOf(made) === F.prototype);
}
function ReadOnly() {}
ReadOnly.prototype.who = function () { return "ReadOnly.prototype"; };
Object.defineProperty(ReadOnly, "prototype", { writable: false });
try {
  ReadOnly.prototype = { who: function () { return "stored behind the lock"; } };
} catch (error) {
  console.log(error.name);
}
show("read-only", ReadOnly);
function Valued() {}
Valued.prototype.who = function () { return "Valued.prototype"; };
Object.defineProperty(Valued, "prototype", { value: { who: function () { return "the value of the descriptor"; } } });
show("a value", Valued);
function Emptied() {}
Emptied.prototype.who = function () { return "Emptied.prototype"; };
Object.defineProperty(Emptied, "prototype", { value: undefined });
show("undefined", Emptied);
function Listed() {}
Listed.prototype.who = function () { return "Listed.prototype"; };
try {
  Object.defineProperty(Listed, "prototype", { enumerable: true });
} catch (error) {
  console.log(error.name);
}
show("listed", Listed);
function Late() {}
Late.prototype.who = function () { return "Late.prototype"; };
var late = { writable: false };
late.value = { who: function () { return "a value stored late"; } };
Object.defineProperty(Late, "prototype", late);
show("late", Late);
function Inherited() {}
Inherited.prototype.who = function () { return "Inherited.prototype"; };
Object.defineProperty(Inherited, "prototype", Object.create({ value: { who: function () { return "a value that the descriptor inherits"; } } }));
show("inherited", Inherited);
var arrow = () => {};
Object.defineProperty(arrow, "prototype", { writable: false });
console.log("arrow", Object.hasOwn(arrow, "prototype"), arrow.prototype, JSON.stringify(Object.getOwnPropertyDescriptor(arrow, "prototype")));
