// Reflect.set of a field that an object no longer has asks its prototypes: a read-only one refuses the store.
class Base { a = 1; b = 0.5; }
Object.defineProperty(Base.prototype, "a", { value: 10 });
const set = (target, value) => Reflect.set(target, "a", value);
const setUnder = (target, name, value) => Reflect.set(target, name, value);
const setThrough = (target, value, receiver) => Reflect.set(target, "a", value, receiver);
const handler = { set(target, name, value, receiver) { return Reflect.set(target, name, value, receiver); } };
const said = [];
for (let i = 0; i < 12; i++) {
  const object = new Base();
  said.push(set(object, i), object.a);
  delete object.a;
  said.push(set(object, i), object.a, setUnder(object, "a", i), setThrough(object, i, object), setThrough(object, i, new Proxy(object, {})));
  try { new Proxy(object, handler).a = i; said.push("stored"); } catch (error) { said.push(error.name); }
  said.push(Object.keys(object).join(), set(object, i) || set(new Base(), i));
}
console.log(said.join(" "));
class Counted { a = 1; }
Object.defineProperty(Counted.prototype, "a", { get() { return "got"; }, set(value) { if (value === 7) throw new RangeError("seven"); this.stored = value; }, configurable: true });
const answers = [];
for (let i = 0; i < 12; i++) {
  const object = new Counted();
  delete object.a;
  try { answers.push(set(object, i), object.a, object.stored); } catch (error) { answers.push(error.name); }
}
Object.defineProperty(Counted.prototype, "a", { value: 3, writable: true });
for (let i = 0; i < 3; i++) {
  const object = new Counted();
  delete object.a;
  answers.push(set(object, i), object.a);
}
console.log(answers.join(" "));
