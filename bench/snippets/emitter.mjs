// **so this file can run in node**
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// --

const EventEmitterNative = require("node:events").EventEmitter;
const TypedEmitter = require("tiny-typed-emitter").TypedEmitter;
const EventEmitter3 = require("eventemitter3").EventEmitter;
import { bench, run } from "../../node_modules/mitata/src/cli.mjs";
const event = new Event("hello");
var id = 0;
for (let [EventEmitter, className] of [
  [EventEmitterNative, "EventEmitter"],
  [TypedEmitter, "TypedEmitter"],
  [EventEmitter3, "EventEmitter3"],
]) {
  const emitter = new EventEmitter();

  emitter.on("hello", event => {
    event.preventDefault();
  });

  bench(`${className}.emit`, () => {
    emitter.emit("hello", {
      preventDefault() {
        id++;
      },
    });
  });

  bench(`${className}.on x 10_000 (handler)`, () => {
    var cb = event => {
      event.preventDefault();
    };
    emitter.on("hey", cb);
    var called = false;
    for (let i = 0; i < 10_000; i++)
      emitter.emit("hey", {
        preventDefault() {
          id++;
          called = true;
        },
      });
    emitter.off("hey", cb);

    if (!called) throw new Error("not called");
  });

  if (EventEmitter !== EventEmitter3) {
    var monkey = Object.assign({}, EventEmitter.prototype);
    monkey.on("hello", event => {
      event.preventDefault();
    });

    bench(`[monkey] ${className}.emit`, () => {
      var called = false;
      monkey.emit("hello", {
        preventDefault() {
          id++;
          called = true;
        },
      });

      if (!called) {
        throw new Error("monkey failed");
      }
    });

    bench(`[monkey] ${className}.on x 10_000 (handler)`, () => {
      var cb = () => {
        event.preventDefault();
      };
      monkey.on("hey", cb);
      for (let i = 0; i < 10_000; i++)
        monkey.emit("hey", {
          preventDefault() {
            id++;
          },
        });
      monkey.off("hey", cb);
    });
  }
}

var target = new EventTarget();
target.addEventListener("hello", event => {});
bench("EventTarget.dispatch", () => {
  target.dispatchEvent(event);
});

var hey = new Event("hey");

bench("EventTarget.on x 10_000 (handler)", () => {
  var handler = event => {};
  target.addEventListener("hey", handler);

  for (let i = 0; i < 10_000; i++) target.dispatchEvent(hey);
  target.removeEventListener("hey", handler);
});

await run();
