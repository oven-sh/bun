import { bench, run } from "mitata";
import { groupForEmitter } from "./implementations.mjs";

var id = 0;

groupForEmitter("single emit", ({ EventEmitter, name }) => {
  const emitter = new EventEmitter();

  emitter.on("hello", event => {
    event.preventDefault();
  });

  bench(name, () => {
    emitter.emit("hello", {
      preventDefault() {
        id++;
      },
    });
  });
});

groupForEmitter("on x 10_000 (handler)", ({ EventEmitter, name }) => {
  const emitter = new EventEmitter();

  bench(name, () => {
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

    if (!called) throw new Error("not called");
  });
});

// for (let { impl: EventEmitter, name, monkey } of []) {
//   if (monkey) {
//     var monkeyEmitter = Object.assign({}, EventEmitter.prototype);
//     monkeyEmitter.on("hello", event => {
//       event.preventDefault();
//     });

//     bench(`[monkey] ${className}.emit`, () => {
//       var called = false;
//       monkeyEmitter.emit("hello", {
//         preventDefault() {
//           id++;
//           called = true;
//         },
//       });

//       if (!called) {
//         throw new Error("monkey failed");
//       }
//     });

//     bench(`[monkey] ${className}.on x 10_000 (handler)`, () => {
//       var cb = () => {
//         event.preventDefault();
//       };
//       monkeyEmitter.on("hey", cb);
//       for (let i = 0; i < 10_000; i++)
//         monkey.emit("hey", {
//           preventDefault() {
//             id++;
//           },
//         });
//       monkeyEmitter.off("hey", cb);
//     });
//   }
// }

// var target = new EventTarget();
// target.addEventListener("hello", event => {});
// bench("EventTarget.dispatch", () => {
//   target.dispatchEvent(event);
// });

// var hey = new Event("hey");

// bench("EventTarget.on x 10_000 (handler)", () => {
//   var handler = event => {};
//   target.addEventListener("hey", handler);

//   for (let i = 0; i < 10_000; i++) target.dispatchEvent(hey);
//   target.removeEventListener("hey", handler);
// });

await run();
