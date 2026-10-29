// One class expression is evaluated below two parents; the second returns a proxy whose trap prints what each field is defined as.
const seen = [];
let Above = class {};
function define() {
  return class Below extends Above {
    count;
    constructor(count) {
      super();
      this.count = count;
    }
  };
}
const First = define();
console.log(new First(1).count);
Above = function () {
  return new Proxy(
    {},
    {
      defineProperty(target, key, descriptor) {
        seen.push(`${String(key)}=${String(descriptor.value)}`);
        return Reflect.defineProperty(target, key, descriptor);
      },
    },
  );
};
const Second = define();
new Second(2);
console.log(seen.join(" "));
