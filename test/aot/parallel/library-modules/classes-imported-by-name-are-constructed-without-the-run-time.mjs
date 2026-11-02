// node:events and node:stream export a function, and their classes hang on it as properties. A listener opens the world: from then on anybody may have stored to those properties.
// The compiler still expects what the library itself stored there, so `new` tests for that function and goes straight to its body. By value each `new` asked the run time for `this`.
// COUNT: operations <= 11455
// COUNT: arrivals <= 185794
import { EventEmitter } from "node:events";
import { Readable, Transform } from "node:stream";
function listener() {}
function emitters(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += new EventEmitter().on("end", listener).listenerCount("end");
  return total;
}
function streams(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total += new Readable({ read() {} }).readableLength + new Transform().writableLength + 1;
  return total;
}
console.log(emitters(5000), streams(5000));
