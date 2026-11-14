// The text is made when the program runs.
const key = Symbol.for(["nodejs", "util", "inspect", "custom"].join("."));
class Held {
  [key](depth, options, inspect) {
    return `held ${typeof inspect} ${inspect({ a: 1 })}`;
  }
}
console.log(new Held());
