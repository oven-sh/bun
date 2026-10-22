// The mixin loop: each own property of the source is described and defined on the target. The getters run on the target, by name and under a key.
class Source {
  constructor() {
    this.count = 0;
  }
  get doubled() {
    return this.count * 2;
  }
  set doubled(value) {
    this.count = value / 2;
  }
  get label() {
    return "count " + this.count;
  }
  bump() {
    this.count++;
    return this;
  }
  static get made() {
    return "made by " + this.name;
  }
}
function Target() {
  this.count = 5;
}
for (const key of Reflect.ownKeys(Source.prototype)) {
  if (key === "constructor") continue;
  Object.defineProperty(Target.prototype, key, Object.getOwnPropertyDescriptor(Source.prototype, key));
}
for (const key of Object.getOwnPropertyNames(Source)) {
  const descriptor = Reflect.getOwnPropertyDescriptor(Source, key);
  if (descriptor.get) Reflect.defineProperty(Target, key, descriptor);
}
const target = new Target();
console.log(target.doubled, target.label, target.bump().doubled, Target.made);
target.doubled = 40;
console.log(target.count, target.label);
for (const key of ["doubled", "label"].slice(globalThis.neverSet ? 1 : 0)) console.log(key, target[key]);
console.log(Object.keys(target), Object.getOwnPropertyNames(Target.prototype).sort().join());
