// What the variable holds at first, how many turns come and who listens at the next entry must not show in the sums.
import { EventEmitter } from "node:events";

let heard = 0;
let emitter = new EventEmitter();
const add = (a, b, c) => void (heard += a + b + c);
emitter.on("tick", add);

function run(turns) {
  let told = 0;
  for (let i = 0; i < turns; i++) told = (told + (emitter.emit("tick", i & 1, 2, 3) ? 1 : 0)) | 0;
  return told;
}
function show(label, turns) {
  let told;
  try {
    told = run(turns);
  } catch (error) {
    told = error.constructor.name;
  }
  console.log(label, turns, told, typeof heard, Object.is(heard, -0) ? "-0" : String(heard));
}

const starts = [0, 1, -0, 0.5, -7.25, 2 ** 31 - 20, -(2 ** 31) - 3, 2 ** 32, 2 ** 53 - 60, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, -(2 ** 53) - 2, 2 ** 60, 1e300, NaN, Infinity, -Infinity];
for (const start of starts) {
  for (const turns of [0, 1, 2, 7, 8, 9, 16, 17, 100]) {
    heard = start;
    show("from " + (Object.is(start, -0) ? "-0" : start), turns);
  }
}
for (const start of ["text", "", undefined, null, true, 5n, { valueOf: () => 40 }, [1]]) {
  heard = start;
  show("from a " + (start === null ? "null" : typeof start), 20);
}

heard = 0;
show("many turns", 3_000_000);
heard = 2 ** 53 - 3_000_000;
show("many turns up to where whole numbers end", 3_000_000);

heard = 0;
const twice = a => void (heard += a * 1000);
emitter.on("tick", twice);
show("two listeners", 20);
emitter.off("tick", add);
show("the other listener alone", 20);
emitter.off("tick", twice);
show("nobody", 20);
emitter.once("tick", add);
show("once", 20);
emitter.on("tick", add);
show("the first again", 20);

let left = 5;
const leaves = () => void (--left === 0 && emitter.off("tick", add));
emitter.prependListener("tick", leaves);
show("the first is taken off in the fifth turn", 20);
emitter.removeAllListeners();

emitter.on("tick", (a, b, c) => {
  heard += a + b + c;
  if (heard > 230) throw new RangeError("enough");
});
show("a listener that throws", 20);
emitter.removeAllListeners("tick");

emitter.on("tick", add);
show("before another emitter", 20);
emitter = new EventEmitter();
show("another emitter without listeners", 20);
emitter.on("tick", add);
emitter.emit = function (name, a) {
  heard -= a;
  return false;
};
show("an emit of its own", 20);
delete emitter.emit;
show("the inherited emit again", 20);
