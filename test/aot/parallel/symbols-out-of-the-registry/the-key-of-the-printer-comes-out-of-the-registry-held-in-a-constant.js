// The registry is held in a constant.
const registry = Symbol.for;
const key = registry("nodejs.util.inspect.custom");
class Held {
  [key](depth, options, inspect) {
    return `held ${typeof inspect} ${inspect({ a: 1 })}`;
  }
}
console.log(new Held());
