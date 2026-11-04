// A proxy above the closure is handed the receiver of a read that finds nothing below it.
function make() {
  const read = () => limit.n;
  Object.setPrototypeOf(
    read,
    new Proxy(Function.prototype, {
      get(target, key, receiver) {
        if (key !== "now") return Reflect.get(target, key, receiver);
        try {
          return receiver();
        } catch (error) {
          return error.name;
        }
      },
    }),
  );
  console.log(read.now);
  const limit = { n: 5 };
  return read;
}
console.log(make()());
