// Objects that hold, or once held, a getter or a setter beside symbols and names are printed, and so are their copies.
const local = Symbol("local");
const show = (label, value) => console.log(label, Bun.inspect(value).replace(/\s+/g, " "), Reflect.ownKeys(value));
function copies(label, made) {
  show(label, made);
  show(label + ", below", Object.create(made));
  show(label + ", assigned", Object.assign({}, made));
  show(label + ", assigned onto a literal", Object.assign({ z: 0 }, made));
  show(label + ", spread", { ...made });
  const { none, ...rest } = made;
  show(label + ", rest", rest);
  show(label + ", as a target", Object.assign(made, { [Symbol.for("late")]: 1, tail: 2 }));
}
{
  const object = { [Symbol.asyncDispose]() {}, get a() {}, valueOf() {} };
  delete object.a;
  console.log(object);
}
{
  const made = {
    [local]: 1,
    get a() {
      return 0;
    },
    name: 2,
  };
  copies("a getter", made);
}
{
  const made = {
    [local]: 1,
    get a() {
      return 0;
    },
    name: 2,
  };
  delete made.a;
  copies("a getter deleted", made);
}
{
  const made = { [local]: 1, set a(value) {}, name: 2 };
  delete made.a;
  copies("a setter deleted", made);
}
{
  const made = {
    [local]: 1,
    get a() {
      return 0;
    },
    name: 2,
  };
  Object.defineProperty(made, "a", { value: 3, writable: true, enumerable: true, configurable: true });
  copies("a getter made a value", made);
}
{
  const made = {
    [local]: 1,
    get a() {
      return 0;
    },
    name: 2,
  };
  delete made.a;
  made.a = 4;
  copies("a getter deleted, a value stored", made);
}
{
  const made = { [local]: 1, name: 2 };
  Object.defineProperty(made, "a", { get: () => 0, enumerable: true, configurable: true });
  delete made.a;
  copies("a defined getter deleted", made);
}
{
  const made = { [local]: 1, name: 2 };
  Object.defineProperty(made, "a", { value: 0, writable: false, enumerable: true, configurable: true });
  delete made.a;
  copies("a read-only value deleted", made);
}
{
  const made = { [local]: 1, name: 2 };
  Object.defineProperty(made, "name", { writable: false });
  Object.defineProperty(made, "name", { writable: true });
  copies("read-only and writable again", made);
}
{
  const made = { [local]: 1, plain: 0, name: 2 };
  delete made.plain;
  copies("a value deleted", made);
}
{
  class Holder {
    [local] = 1;
    name = 2;
  }
  const made = new Holder();
  Object.defineProperty(made, "a", { get: () => 0, enumerable: true, configurable: true });
  delete made.a;
  copies("an instance, a defined getter deleted", made);
}
{
  const made = {
    [local]: 1,
    get [Symbol.for("got")]() {
      return 0;
    },
    name: 2,
  };
  delete made[Symbol.for("got")];
  copies("a getter under a symbol deleted", made);
}
