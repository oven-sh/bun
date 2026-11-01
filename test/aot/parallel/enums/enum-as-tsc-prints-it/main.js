// What tsc prints for an enum in a published .js file. The object is born with its members where nothing can tell, and everything that can tell still does.
import { Exported, changeExported } from "./exported.js";
const show = (name, value) => console.log(name, JSON.stringify(value), JSON.stringify(Object.keys(value)));

console.log("before", typeof Color, early());
function early() {
  try {
    return Color.Red;
  } catch (error) {
    return error.constructor.name;
  }
}
var Color;
(function (Color) {
  Color[(Color["Red"] = 0)] = "Red";
  Color[(Color["Green"] = 1)] = "Green";
  Color[(Color["Blue"] = 4)] = "Blue";
  Color[(Color["Alias"] = 1)] = "Alias";
  Color["Name"] = "name";
})(Color || (Color = {}));
show("numbers and a string", Color);
console.log(early(), Color[1], Color[4], Color[2], Color.Name, Color.Missing, "Red" in Color, 0 in Color);
console.log(
  Object.getPrototypeOf(Color) === Object.prototype,
  Object.isExtensible(Color),
  Object.getOwnPropertyDescriptor(Color, "Green"),
);

var Changed;
(function (Changed) {
  Changed[(Changed["A"] = 0)] = "A";
  Changed[(Changed["B"] = 1)] = "B";
})(Changed || (Changed = {}));
const pick = value => {
  switch (value) {
    case Changed.A:
      return "A";
    case Changed.B:
      return "B";
    default:
      return "none";
  }
};
console.log(pick(0), pick(1), pick(7));
Changed.B = 7;
delete Changed.A;
Changed.C = 2;
console.log(pick(0), pick(1), pick(7), pick(undefined));
show("changed", Changed);

var Merged;
(function (Merged) {
  Merged[(Merged["A"] = 0)] = "A";
})(Merged || (Merged = {}));
(function (Merged) {
  Merged[(Merged["B"] = 1)] = "B";
})(Merged || (Merged = {}));
show("two declarations", Merged);

var Given = { already: true };
(function (Given) {
  Given[(Given["A"] = 0)] = "A";
})(Given || (Given = {}));
show("a variable with a value", Given);

var Stored;
Stored = { already: true };
(function (Stored) {
  Stored[(Stored["A"] = 0)] = "A";
})(Stored || (Stored = {}));
show("a variable stored to before", Stored);

var Odd;
(function (Odd) {
  Odd[(Odd["Minus"] = -1)] = "Minus";
  Odd[(Odd["Half"] = 0.5)] = "Half";
  Odd[(Odd["Zero"] = 0)] = "Zero";
})(Odd || (Odd = {}));
show("numbers that are no index", Odd);

var Computed;
(function (Computed) {
  Computed[(Computed["A"] = 1)] = "A";
  Computed[(Computed["B"] = Computed.A << 2)] = "B";
  Computed[(Computed["C"] = "abc".length)] = "C";
})(Computed || (Computed = {}));
show("computed members", Computed);

var Names;
(function (Names) {
  Names[(Names["constructor"] = 0)] = "constructor";
  Names[(Names["toString"] = 1)] = "toString";
  Names[(Names["hasOwnProperty"] = 2)] = "hasOwnProperty";
})(Names || (Names = {}));
console.log("names of Object.prototype", Object.keys(Names).join(), Names.constructor, Names.toString, Names[2]);

var Proto;
(function (Proto) {
  Proto[(Proto["__proto__"] = 0)] = "__proto__";
  Proto[(Proto["A"] = 1)] = "A";
})(Proto || (Proto = {}));
console.log("__proto__", Object.keys(Proto).join(), Object.getPrototypeOf(Proto) === Object.prototype);

var Twice;
(function (Twice) {
  Twice[(Twice["A"] = 0)] = "A";
  Twice[(Twice["A"] = 1)] = "A";
})(Twice || (Twice = {}));
show("a name twice", Twice);

function make() {
  var Inner;
  (function (Inner) {
    Inner[(Inner["A"] = 0)] = "A";
    Inner[(Inner["B"] = 1)] = "B";
  })(Inner || (Inner = {}));
  return Inner;
}
const [first, second] = [make(), make()];
first.A = 9;
console.log("in a function", first === second, first.A, second.A, second[1]);

for (let turn = 0; turn < 2; turn++) {
  var Looped;
  (function (Looped) {
    Looped[(Looped["A"] = 0)] = "A";
    Looped.turns = (Looped.turns ?? 0) + 1;
  })(Looped || (Looped = {}));
}
show("in a loop", Looped);

var Other = {};
var Mixed;
(function (Mixed) {
  Mixed[(Mixed["A"] = 0)] = "A";
  Other[(Mixed["B"] = 1)] = "B";
})(Mixed || (Mixed = {}));
show("a store into another object", Mixed);
show("the other object", Other);

var Shadow;
(function (Parameter) {
  Parameter[(Parameter["A"] = 0)] = "A";
  Parameter[(Parameter["B"] = 1)] = "B";
})(Shadow || (Shadow = {}));
show("a parameter of another name", Shadow);

var Arrow = /* @__PURE__ */ (Arrow2 => {
  Arrow2[(Arrow2["A"] = 0)] = "A";
  Arrow2[(Arrow2["B"] = 3)] = "B";
  Arrow2["C"] = "c";
  return Arrow2;
})(Arrow || {});
show("as esbuild prints it", Arrow);
Arrow.B = 9;
console.log(Arrow.B, Arrow[3], Object.getPrototypeOf(Arrow) === Object.prototype);

var Returned = /*#__PURE__*/ (function (Returned) {
  Returned[(Returned["A"] = 0)] = "A";
  Returned[(Returned["B"] = 1)] = "B";
  return Returned;
})(Returned || {});
show("as swc and Babel print it", Returned);

var Bare = /*#__PURE__*/ (function (Bare) {
  Bare[(Bare["A"] = 0)] = "A";
  Bare[(Bare["B"] = 1)] = "B";
  return Bare;
})({});
show("as newer swc prints it", Bare);
const bare = () =>
  (function (E) {
    E[(E["A"] = 0)] = "A";
    return E;
  })({});
console.log("a new object each time", bare() === bare(), bare().A, bare()[0]);

var Again = (Again2 => {
  Again2[(Again2["A"] = 0)] = "A";
  return Again2;
})(Again || {});
var Again = (Again2 => {
  Again2[(Again2["B"] = 1)] = "B";
  return Again2;
})(Again || {});
show("two declarations with values", Again);

var NotReturned = (function (NotReturned) {
  NotReturned[(NotReturned["A"] = 0)] = "A";
})(NotReturned || {});
console.log("nothing returned", NotReturned);

var OtherReturned = (function (OtherReturned) {
  OtherReturned[(OtherReturned["A"] = 0)] = "A";
  return Other;
})(OtherReturned || {});
console.log("another object returned", OtherReturned === Other);

var StoredLater = (StoredLater2 => {
  StoredLater2[(StoredLater2["A"] = 0)] = "A";
  return StoredLater2;
})(StoredLater || {});
const before = StoredLater;
StoredLater = { replaced: true };
show("stored to afterwards", StoredLater);
show("what it held", before);

const required = require("./required.cjs");
show("exported by a CommonJS file", required.Level);
console.log(required.pick(0), required.pick(1), required.pick(2));
required.Level.High = 2;
console.log(required.pick(0), required.pick(1), required.pick(2));

show("exported", Exported);
changeExported();
console.log(Exported.On, Exported[1], Exported.Off);
