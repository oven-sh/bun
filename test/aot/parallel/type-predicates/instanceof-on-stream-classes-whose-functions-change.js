// The constructors of node:stream ask `this instanceof Duplex`. $toClass has put each function below its base's.
const { Readable, Writable, Duplex, Transform, PassThrough, Stream } = require("node:stream");
const EventEmitter = require("node:events");

function ask(value) {
  return [
    value instanceof PassThrough,
    value instanceof Transform,
    value instanceof Duplex,
    value instanceof Readable,
    value instanceof Writable,
    value instanceof Stream,
    value instanceof EventEmitter,
  ]
    .map(Number)
    .join("");
}
function warm() {
  let text = "";
  for (let i = 0; i < 200; i++)
    text = [
      new PassThrough(),
      new Transform(),
      new Duplex(),
      new Readable({ read() {} }),
      new Writable(),
      Transform(),
      Duplex(),
      {},
    ]
      .map(ask)
      .join(" ");
  return text;
}
const say = label => console.log(label, warm());
say("as loaded");

let calls = 0;
const yes = {
  value(object) {
    calls++;
    return object != null;
  },
  configurable: true,
};
for (const [name, fn] of Object.entries({ EventEmitter, Stream, Readable, Duplex, Transform, PassThrough })) {
  calls = 0;
  Object.defineProperty(fn, Symbol.hasInstance, yes);
  say(name + " says yes");
  console.log(calls > 0);
  delete fn[Symbol.hasInstance];
  say(name + " says nothing again");
}

function Other() {}
Object.defineProperty(Other, Symbol.hasInstance, yes);
for (const [name, fn] of Object.entries({ Stream, Readable, Duplex, Transform })) {
  const parent = Object.getPrototypeOf(fn);
  Object.setPrototypeOf(fn, Other);
  say(name + " stands below a function that says yes");
  Object.setPrototypeOf(fn, parent);
  say(name + " is back");
}

const transform = new Transform();
const kept = Object.getPrototypeOf(Transform.prototype);
Object.setPrototypeOf(Transform.prototype, Readable.prototype);
console.log("Transform.prototype skips Duplex.prototype", ask(transform));
Object.setPrototypeOf(Transform.prototype, kept);
console.log("and stands below it again", ask(transform), ask(new Transform()), ask(new PassThrough()));
Object.setPrototypeOf(transform, Readable.prototype);
console.log("one stream moved", ask(transform), ask(new Transform()));
