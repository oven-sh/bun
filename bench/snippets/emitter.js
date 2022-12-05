const EventEmitter = require("events").EventEmitter;
import { bench, run } from "mitata";

const emitter = new EventEmitter();
const event = new Event("hello");
emitter.on("hello", (event) => {
  event.preventDefault();
});

var id = 0;
bench("EventEmitter.emit", () => {
  emitter.emit("hello", {
    preventDefault() {
      id++;
    },
  });
});

var monkey = Object.assign({}, EventEmitter.prototype);
monkey.on("hello", (event) => {
  event.preventDefault();
});

bench("[monkey] EventEmitter.emit", () => {
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

bench("EventEmitter.on x 10_000 (handler)", () => {
  var cb = (event) => {
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

bench("[monkey] EventEmitter.on x 10_000 (handler)", () => {
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

var target = new EventTarget();
target.addEventListener("hello", (event) => {});
bench("EventTarget.dispatch", () => {
  target.dispatchEvent(event);
});

var hey = new Event("hey");

bench("EventTarget.on x 10_000 (handler)", () => {
  var handler = (event) => {};
  target.addEventListener("hey", handler);

  for (let i = 0; i < 10_000; i++) target.dispatchEvent(hey);
  target.removeEventListener("hey", handler);
});

await run();
