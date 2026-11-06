// Elements are stored into objects whose prototype is a typed array, at indexes that the typed array has and does not have: first into sealed objects that have an element, then after a proxy was put above the prototype object of a function that nothing constructs. Plain Bun prints another output.
function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}
function listKeys(object) {
  return JSON.stringify(Reflect.ownKeys(object));
}
function below(own, above) {
  Object.setPrototypeOf(own, above);
  return own;
}
show("sealed, an index past the end", () => {
  const sealed = Object.seal(below({ a: 1, 9: 1.5 }, new Uint8Array(0)));
  sealed[100] = 1.5;
  return listKeys(sealed);
});
show("sealed, its own index", () => {
  const sealed = Object.seal(below({ a: 1, 9: 1.5 }, new Uint8Array(0)));
  sealed[9] = 2.5;
  return listKeys(sealed) + sealed[9];
});
show("sealed, a name", () => {
  const sealed = Object.seal(below({ a: 1, 9: 1.5 }, new Uint8Array(0)));
  sealed.b = 1;
  return listKeys(sealed);
});

function NeverConstructed() {}
Object.setPrototypeOf(NeverConstructed.prototype, new Proxy({}, {}));

for (const index of [0, 3, 8, 9, 100000, 4294967294, "7", "9", -1, 1.5, "-0", "1e3", "x"]) {
  show("store " + typeof index + " " + String(index), () => {
    const object = below({}, new Uint8Array(8));
    object[index] = 1;
    return listKeys(object);
  });
}
show("Reflect.set past the end", () => {
  const object = below({}, new Uint8Array(8));
  return Reflect.set(object, 9, 1) + listKeys(object);
});
show("Reflect.set inside", () => {
  const object = below({}, new Uint8Array(8));
  return Reflect.set(object, 3, 1) + listKeys(object);
});
show("an empty typed array", () => {
  const object = below({}, new Float64Array());
  object[5] = "x";
  return listKeys(object);
});
show("__proto__", () => {
  const object = {};
  object.__proto__ = new Float64Array();
  object[5] = "x";
  return listKeys(object);
});
show("Object.create", () => {
  const object = Object.create(new Uint8Array(2));
  object[5] = "x";
  object[1] = "y";
  return listKeys(object);
});
show("two above", () => {
  const object = Object.create(Object.create(new Uint8Array(2)));
  object[5] = "x";
  return listKeys(object);
});
show("an array below", () => {
  const list = below([], new Uint8Array(2));
  list[5] = "x";
  return listKeys(list);
});
show("a subclass above", () => {
  class Bytes extends Uint8Array {}
  const object = Object.create(new Bytes(2));
  object[5] = "x";
  return listKeys(object);
});
show("sealed, without elements", () => {
  const sealed = Object.seal(below({ a: 1 }, new Uint8Array(0)));
  sealed[100] = 1.5;
  return listKeys(sealed);
});
/* Output:
sealed, an index past the end ["9","a"]
sealed, its own index ["9","a"]2.5
sealed, a name throws TypeError
store number 0 ["0"]
store number 3 ["3"]
store number 8 []
store number 9 []
store number 100000 []
store number 4294967294 []
store string 7 ["7"]
store string 9 []
store number -1 []
store number 1.5 []
store string -0 []
store string 1e3 ["1e3"]
store string x ["x"]
Reflect.set past the end true[]
Reflect.set inside true["3"]
an empty typed array []
__proto__ []
Object.create ["1"]
two above []
an array below ["length"]
a subclass above []
sealed, without elements ["a"]
*/
