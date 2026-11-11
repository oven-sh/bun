// The program has the symbol, by Symbol.for: an object may have the method that printing calls, and what it is called with is in the executable.
class Point {
  [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) {
    return "a point " + typeof inspect;
  }
}
process.nextTick(() => console.log(new Point()));
