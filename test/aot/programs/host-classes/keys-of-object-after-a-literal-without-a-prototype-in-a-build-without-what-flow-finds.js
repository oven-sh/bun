// A literal without a prototype reads no member of Object, also where the build calls Object.create by its value.
const bare = { __proto__: null };
console.log(typeof bare, Object.getPrototypeOf(bare));
Object.entries(Object);
console.log(Reflect.ownKeys(Object).join());
console.log(
  Object.create === Object["cre" + (Date.now() < 5 ? "x" : "ate")],
  Object.getPrototypeOf(Object.create(null)),
);
