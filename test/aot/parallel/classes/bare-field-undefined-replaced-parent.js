// The parent of a class is replaced by a function that returns a proxy, and the trap prints what each field is defined as.
class Above {}
class Below extends Above {
  count;
  constructor(count) {
    super();
    this.count = count;
  }
}
const seen = [];
Object.setPrototypeOf(Below, function () {
  return new Proxy(
    {},
    {
      defineProperty(target, key, descriptor) {
        seen.push(`${String(key)}=${String(descriptor.value)}`);
        return Reflect.defineProperty(target, key, descriptor);
      },
    },
  );
});
new Below(1);
console.log(seen.join(" "));
