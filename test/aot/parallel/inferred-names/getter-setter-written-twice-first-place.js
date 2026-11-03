// Lists the keys of literals and classes in which a getter or a setter is written twice with another member between: a key keeps the place of its first member. Plain Bun prints another output.
function keys(label, made) {
  console.log(label + ":", Reflect.ownKeys(made).join(","));
}
keys("a setter, a value, the setter again", { set a(stored) {}, b: 1, set a(stored) {} });
keys("a getter, a value, the getter again", {
  get a() {
    return 1;
  },
  b: 1,
  get a() {
    return 2;
  },
});
keys("a getter, a value, the setter", {
  get a() {
    return 1;
  },
  b: 1,
  set a(stored) {},
});
keys("a setter, a getter of another name, the setter again", {
  set a(stored) {},
  get b() {
    return 1;
  },
  set a(stored) {},
});
keys("a value, a value, a getter over the first", {
  a: 1,
  b: 1,
  get a() {
    return 2;
  },
});
keys("a getter, a value, a value over the getter", {
  get a() {
    return 1;
  },
  b: 1,
  a: 2,
});
keys("a method, a value, the method again", { a() {}, b: 1, a() {} });
keys(
  "in a class",
  class {
    static set a(stored) {}
    static b() {}
    static set a(stored) {}
  },
);
/* Output:
a setter, a value, the setter again: a,b
a getter, a value, the getter again: a,b
a getter, a value, the setter: a,b
a setter, a getter of another name, the setter again: a,b
a value, a value, a getter over the first: a,b
a getter, a value, a value over the getter: a,b
a method, a value, the method again: a,b
in a class: length,name,prototype,a,b
*/
