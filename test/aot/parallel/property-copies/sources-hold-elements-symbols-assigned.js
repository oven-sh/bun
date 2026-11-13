// Object.assign, spreads and rests copy objects that hold elements of several kinds beside symbols and names; what they make is printed.
const local = Symbol("local");
const other = Symbol("other");
const show = (label, value) => console.log(label, Bun.inspect(value).replace(/\s+/g, " "), Reflect.ownKeys(value));
function withElement() {
  return { [local]: 0, 0: "e", a: 1 };
}
function withHiddenElement() {
  const made = { [local]: 0 };
  Object.defineProperty(made, 0, { value: "hidden", enumerable: false, writable: true, configurable: true });
  Object.defineProperty(made, "a", { value: "v", enumerable: true, writable: true, configurable: true });
  return made;
}
function withLateElements() {
  const made = {};
  made.first = 1;
  made[local] = 2;
  made[7] = "seven";
  made.last = 3;
  made[other] = 4;
  made[2] = "two";
  return made;
}
function withElementGetter() {
  const made = { [local]: 0, a: 1 };
  Object.defineProperty(made, 0, { get: () => "got", enumerable: true, configurable: true });
  return made;
}
function withFarElement() {
  const made = { [local]: 0, a: 1 };
  made[100000] = "far";
  return made;
}
class Target {
  own = 1;
}
for (const make of [withElement, withHiddenElement, withLateElements, withElementGetter, withFarElement]) {
  show(make.name + " itself", make());
  show(make.name + " onto a literal", Object.assign({ z: 0 }, make()));
  show(make.name + " onto an empty literal", Object.assign({}, make()));
  show(make.name + " twice", Object.assign({ z: 0 }, make(), { last: 1 }, make()));
  show(make.name + " onto an instance", Object.assign(new Target(), make()));
  show(make.name + " onto a created object", Object.assign(Object.create(null), make()));
  show(make.name + " onto a parsed object", Object.assign(JSON.parse('{"p":1}'), make()));
  show(make.name + " onto an array", Object.assign([9, 9], make()));
  show(make.name + " onto elements", Object.assign({ 0: "old", 5: "five", z: 0 }, make()));
  show(make.name + " spread", { z: 0, ...make() });
  const { a, ...rest } = make();
  show(make.name + " rest", rest);
}
