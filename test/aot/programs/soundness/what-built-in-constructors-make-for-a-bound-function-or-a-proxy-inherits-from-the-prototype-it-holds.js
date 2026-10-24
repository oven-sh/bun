// Reflect.construct(Base, [], other): the new object inherits from other.prototype, whatever kind of function `other` is.
function show(label, make) {
  try {
    const made = make();
    console.log(label, typeof made.peek, made.mark);
  } catch (error) {
    console.log(label, "threw", error.name);
  }
}
const bound = given => {
  const B = function () {}.bind();
  B.prototype = given;
  return B;
};
show("map for bound", () => Reflect.construct(Map, [], bound({ peek() {}, mark: "m1" })));
show("object for bound", () => Reflect.construct(Object, [], bound({ peek() {}, mark: "m2" })));
show("array for bound", () => Reflect.construct(Array, [], bound({ peek() {}, mark: "m3" })));
show("error for bound", () => Reflect.construct(Error, [], bound({ peek() {}, mark: "m4" })));
show("promise for bound", () => Reflect.construct(Promise, [() => {}], bound({ peek() {}, mark: "m5" })));
show("function for bound", () => Reflect.construct(Function, [], bound({ peek() {}, mark: "m6" })));
show("date for proxy", () => Reflect.construct(Date, [], new Proxy(function () {}, { get: (target, key) => (key === "prototype" ? { peek() {}, mark: "m7" } : target[key]) })));
class OverSet extends Set {}
show("class over set for proxy", () => Reflect.construct(OverSet, [], new Proxy(function () {}, { get: (target, key) => (key === "prototype" ? { peek() {}, mark: "m8" } : target[key]) })));
const arrow = () => {};
arrow.prototype = { peek() {}, mark: "m9" };
show("regexp for method", () => Reflect.construct(RegExp, ["a"], Object.assign(class {}.bind(), { prototype: { peek() {}, mark: "m10" } })));
class OverObject extends Object {}
show("class over object for bound class", () => Reflect.construct(OverObject, [], Object.assign(class {}.bind(), { prototype: { peek() {}, mark: "m11" } })));
