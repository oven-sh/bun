// The text is spelled out: the method under the symbol runs, and is handed util.inspect.
const key = Symbol.for("nodejs.util.inspect.custom");
class Held {
  [key](depth, options, inspect) {
    return `held ${typeof inspect} ${inspect({ a: 1 })}`;
  }
}
console.log(new Held());
