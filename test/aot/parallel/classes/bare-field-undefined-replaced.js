// The parent of the parent is replaced by a function that returns a proxy, and the trap prints what each field is defined as.
const seen = [];
class Top {}
class Middle extends Top {}
class Below extends Middle {
  count;
  constructor(count) {
    super();
    this.count = count;
  }
}
console.log(new Below(1).count);
Object.setPrototypeOf(Middle, function () {
  return new Proxy({}, {
    defineProperty(target, key, descriptor) {
      seen.push(`${String(key)}=${String(descriptor.value)}`);
      return Reflect.defineProperty(target, key, descriptor);
    },
  });
});
new Below(2);
console.log(seen.join(" "));
