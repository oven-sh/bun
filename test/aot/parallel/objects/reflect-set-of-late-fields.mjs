// Reflect.set of fields that methods add late: they lie outside the object's cell, hold their values, and where they are gone a prototype may refuse them.
class Late {
  first = 1;
  begin(value) { this.second = value; this.third = value + 0.5; }
  more(value) { this.fourth = "f" + value; if (value & 1) this.fifth = { value }; }
}
Object.defineProperty(Late.prototype, "third", { value: "refused" });
const set = (target, value) => Reflect.set(target, "second", value);
const setThird = (target, value) => Reflect.set(target, "third", value);
const setUnder = (target, name, value) => Reflect.set(target, name, value);
const handler = { set(target, name, value, receiver) { return Reflect.set(target, name, value, receiver); } };
const said = [];
for (let i = 0; i < 24; i++) {
  const object = new Late();
  if (i % 4) { try { object.begin(i); } catch (error) { said.push(error.name); } }
  object.more(i);
  said.push(set(object, i * 2), object.second, setThird(object, i), object.third, setUnder(object, "fourth", i), object.fourth, setUnder(object, "fifth", i / 4), object.fifth);
  const proxy = new Proxy(object, handler);
  try { proxy.second = "s" + i; proxy.fourth = -i; proxy.fifth = null; proxy.third = i; } catch (error) { said.push(error.name); }
  said.push(object.second, object.fourth, object.fifth, Object.keys(object).join(""));
  delete object.second;
  said.push(set(object, i), object.second, setUnder(proxy, "second", 0.25), object.second);
  Object.defineProperty(object, "third", { value: i, writable: true, configurable: true, enumerable: true });
  said.push(setThird(object, i + 1), object.third);
  delete object.third;
  said.push(setThird(object, i + 2), object.third, Object.hasOwn(object, "third"));
}
console.log(said.join(" "));
