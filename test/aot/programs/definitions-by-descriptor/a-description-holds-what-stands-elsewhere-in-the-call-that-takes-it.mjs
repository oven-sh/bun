// What a definition puts on its target comes out of the description. Here that value also stands in the call itself: it is the object that the function was read from,
// the description, the map of descriptions, or an argument too many.
const { create, defineProperties, defineProperty, getOwnPropertyDescriptors } = Object;
const show = (name, target, key, expected) => {
  const found = Object.getOwnPropertyDescriptor(target, key) ?? {};
  console.log(name, found.value === expected, found.get === expected, found.set === expected);
};

function copy(source) {
  return defineProperties(create(null), getOwnPropertyDescriptors(source));
}
show("a copy made by functions taken off Object", copy(Object.prototype), "constructor", Object);
class Named {}
show("a copy of a class's prototype", copy(Named.prototype), "constructor", Named);
show("a copy of Function.prototype", copy(Function.prototype), "constructor", Function);
show("a copy of Array.prototype", copy(Array.prototype), "constructor", Array);

show("a map written out", Object.defineProperties({}, { held: { value: Object } }), "held", Object);
show("a getter in a map", Object.defineProperties({}, { held: { get: Object } }), "held", Object);
show("a setter in a map", Object.defineProperties({}, { held: { set: Object } }), "held", Object);
show("an inherited value in a map", Object.defineProperties({}, { held: Object.create({ value: Object }) }), "held", Object);
show("under a symbol", Object.defineProperties({}, { [Symbol.iterator]: { value: Object } }), Symbol.iterator, Object);
show("under an index", Object.defineProperties({}, { 0: { value: Object } }), 0, Object);

const kept = { value: Object, enumerable: true };
show("a description kept in a constant", Object.defineProperty({}, "held", kept), "held", Object);
show("an inherited value", Object.defineProperty({}, "held", Object.create(kept)), "held", Object);

const target = {};
console.log(Reflect.defineProperty(target, "held", { value: Reflect }));
show("Reflect", target, "held", Reflect);

const description = { enumerable: true };
description.value = description;
show("the description itself", Object.defineProperty({}, "held", description), "held", description);

const map = { held: { enumerable: true } };
map.held.value = map;
show("the map itself", Object.defineProperties({}, map), "held", map);

const extra = function () {};
show("an argument too many", Object.defineProperty({}, "held", { value: extra }, extra), "held", extra);
show("an argument too many behind a map", Object.defineProperties({}, { held: { value: extra } }, extra), "held", extra);
show("another receiver", Object.defineProperty.call(extra, {}, "held", { value: extra }), "held", extra);
