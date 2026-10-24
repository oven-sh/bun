// The streams are found through an object that forwards to console, and through one that inherits from it.
const forwarded = new Proxy(console, {});
console.log(forwarded._stdout === process.stdout, Reflect.has(forwarded, "_stderr"));

const asked = [];
const watched = new Proxy(console, {
  get(target, name, receiver) {
    asked.push(String(name));
    return Reflect.get(target, name, receiver);
  },
});
console.log(watched._stderr === process.stderr, asked.join(" "));

const heir = Object.create(console);
console.log(heir._stdout === process.stdout, Object.keys(heir).length);
class Logger {
  constructor() {
    return Object.setPrototypeOf(this, console);
  }
}
console.log(new Logger()._stderr === process.stderr);
