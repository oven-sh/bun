// What console.log() prints of an event holds its target, which may say itself how it is printed.
class Mine extends EventTarget {
  [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) {
    return "Mine<" + inspect({ a: 1, b: [2, 3] }) + ">";
  }
}
const withoutTime = event => Bun.inspect(event).replace(/timeStamp: [0-9.]+/, "timeStamp: 0");
const mine = new Mine();
const event = new Event("x");
console.log(withoutTime(event));
mine.dispatchEvent(event);
console.log(withoutTime(event));
console.log(event.target);
console.log([event.srcElement]);
