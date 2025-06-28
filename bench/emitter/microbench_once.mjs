import { bench, run } from "../runner.mjs";
import { groupForEmitter } from "./implementations.mjs";

var id = 0;

groupForEmitter("test 1", ({ EventEmitter, name }) => {
  const emitter = new EventEmitter();

  emitter.on("hello", event => {
    event.preventDefault();
  });

  bench(name, () => {
    emitter.once("hello", event => {
      event.preventDefault();
    });
    emitter.emit("hello", {
      preventDefault() {
        id++;
      },
    });
  });
});

groupForEmitter("test 2", ({ EventEmitter, name }) => {
  const emitter = new EventEmitter();

  bench(name, () => {
    emitter.once("hello", event => {
      event.preventDefault();
    });
    emitter.emit("hello", {
      preventDefault() {
        id++;
      },
    });
  });
});

await run();
