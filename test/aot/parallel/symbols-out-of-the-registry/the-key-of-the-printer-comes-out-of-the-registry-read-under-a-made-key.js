// The registry is read under a key that is made.
const key = Symbol["f" + "or"]("nodejs.util.inspect.custom");
class Held {
  [key](depth, options, inspect) {
    return `held ${typeof inspect} ${inspect({ a: 1 })}`;
  }
}
console.log(new Held());
