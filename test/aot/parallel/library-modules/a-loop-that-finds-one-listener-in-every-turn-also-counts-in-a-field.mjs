// A loop finds the same thing under one name in every turn while it stores to fields, reads constants of its module from inside a function, or hands on five arguments.
import { EventEmitter } from "node:events";

let heard = 0;
function attempt(label, run) {
  heard = 0;
  let answer;
  try {
    answer = run();
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(`${label}: ${answer} ${heard}`);
}

// The loop stores to a field of the emitter in every turn.
class Source extends EventEmitter {
  count = 0;
  push(chunk) {
    this.count++;
    return this.emit("data", chunk);
  }
}
const source = new Source();
const odd = i => void (heard += i & 1);
source.on("data", odd);
function pushOften(turns) {
  let answered = 0;
  for (let i = 0; i < turns; i++) if (source.push(i)) answered++;
  return `${answered} ${source.count}`;
}
attempt("one listener", () => pushOften(100000));
attempt("again", () => pushOften(1000));
attempt("no turn", () => pushOften(0));
attempt("one turn", () => pushOften(1));
source.on("data", odd);
attempt("two listeners", () => pushOften(1000));
source.removeAllListeners("data");
attempt("nobody listens", () => pushOften(1000));
source.on("data", i => {
  heard += 1;
  if (i === 4) source.count = 1000.5;
});
attempt("the listener stores to the field", () => pushOften(10));
source.removeAllListeners("data");
source.on("data", odd);
source.count = 2147483640;
attempt("the count leaves the int32 range", () => pushOften(20));
source.count = "7";
attempt("the count is a text", () => pushOften(3));
let reads = 0;
Object.defineProperty(source, "count", { get() { reads++; return 5; }, set(value) { heard += 100; }, configurable: true });
attempt("the count is an accessor", () => pushOften(3) + " " + reads);
Object.defineProperty(source, "count", { value: 0, writable: true, configurable: true, enumerable: true });
attempt("the count is a value again", () => pushOften(1000));
Object.freeze(source);
attempt("the emitter is frozen", () => pushOften(1000));

// The field that the loop stores to has the name that the loop reads off a table, and the table may be that object, or lie below it.
class Pace {
  constructor() {
    this.step = 1;
    this.total = 0;
  }
}
function walk(table, pace, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    pace.step = i & 3;
    sum = (sum + table.step) | 0;
  }
  return sum;
}
function add(table, pace, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    pace.total = pace.total + 1;
    sum = (sum + table.step) | 0;
  }
  return `${sum} ${pace.total}`;
}
const tableOf = step => {
  const made = Object.create(null);
  made[Date.now() > 0 ? "step" : "pace"] = step;
  return made;
};
for (const turns of [0, 1, 2, 1000, 100000]) {
  const pace = new Pace();
  attempt(`${turns} turns, a table of its own`, () => walk(tableOf(2), pace, turns) + " " + add(tableOf(2), pace, turns));
  attempt(`${turns} turns, a table below the object`, () => walk(Object.create(pace), pace, turns) + " " + add(Object.create(pace), pace, turns));
  attempt(`${turns} turns, the object itself`, () => walk(pace, pace, turns) + " " + add(pace, pace, turns));
  attempt(`${turns} turns, total for step`, () => add({ get step() { return pace.total; } }, pace, turns));
}

// How many listen is asked from inside a function that reads a constant of the module, also before the constant is there.
function countOnce() {
  return late.listenerCount("tick");
}
function countOften(turns, from = 0) {
  let sum = 0;
  for (let i = 0; i < turns; i++) if (i >= from) sum = (sum + countOnce() + (i & 1)) | 0;
  return sum;
}
attempt("no turn ahead of the constant", () => countOften(0));
attempt("turns that do not ask ahead of the constant", () => countOften(1000, 1000));
attempt("the first turn asks ahead of the constant", () => countOften(1000));
attempt("the fourth turn asks ahead of the constant", () => countOften(1000, 3));
const late = new EventEmitter();
attempt("nobody listens yet", () => countOften(100000));
late.on("tick", () => {});
attempt("one listens", () => countOften(100000));
attempt("one listens, asked from the fourth turn on", () => countOften(1000, 3));
late.on("tick", () => {});
attempt("two listen", () => countOften(1000));
late.on("tick", odd);
attempt("three listen", () => countOften(1000));
late.removeAllListeners();
attempt("nobody listens any more", () => countOften(1000));
late._events = { __proto__: null, tick: 5 };
attempt("a number lies in the table", () => countOften(10));
late._events = { __proto__: null, tick: null };
attempt("null lies in the table", () => countOften(10));
late._events = { __proto__: null, tick: { length: 7 } };
attempt("an object with a length lies in the table", () => countOften(10));

// Five arguments and more reach the one listener, however it takes them.
const wide = new EventEmitter();
function emitFive(turns) {
  let answered = 0;
  for (let i = 0; i < turns; i++) if (wide.emit("tick", i & 1, 2, 3, 4, 5)) answered++;
  return answered;
}
function emitSeven(turns) {
  let answered = 0;
  for (let i = 0; i < turns; i++) if (wide.emit("tick", i & 1, 2, 3, 4, 5, 6, 7)) answered++;
  return answered;
}
attempt("five arguments, nobody listens", () => emitFive(1000));
const five = (a, b, c, d, e) => void (heard += a + b + c + d + e);
wide.on("tick", five);
attempt("five arguments", () => emitFive(100000));
attempt("seven arguments for five parameters", () => emitSeven(1000));
wide.on("tick", five);
attempt("five arguments, two listeners", () => emitFive(1000));
wide.removeAllListeners();
wide.on("tick", function (first, ...rest) { heard += first + rest.length + (this === wide ? 10 : 0); });
attempt("five arguments, a rest parameter", () => emitFive(1000));
attempt("seven arguments, a rest parameter", () => emitSeven(1000));
wide.removeAllListeners();
wide.on("tick", function () { heard += arguments.length + arguments[4]; });
attempt("five arguments, counted", () => emitFive(1000));
wide.removeAllListeners();
wide.on("tick", (a, b) => {
  if (a + b === 3 && heard++ > 5) throw new RangeError("enough");
});
attempt("five arguments, a listener that throws", () => emitFive(1000));

// What the one listener adds to is a number, until a turn makes something else of it, and it may not be there yet.
const early = new EventEmitter();
early.on("tick", (a, b, c) => void (tally += tally === 12 ? "!" : a + b + c));
function emitThree(turns) {
  let answered = 0;
  for (let i = 0; i < turns; i++) if (early.emit("tick", 1, 2, 3)) answered++;
  return answered;
}
attempt("no turn ahead of the sum", () => emitThree(0));
attempt("turns ahead of the sum", () => emitThree(5));
let tally = 0;
attempt("the sum stays a number", () => `${emitThree(2)} ${tally}`);
attempt("the sum becomes a text in the first turn", () => `${emitThree(3)} ${tally}`);
tally = 6;
attempt("the sum becomes a text in the second turn", () => `${emitThree(4)} ${tally}`);
tally = 13;
attempt("the sum grows", () => `${emitThree(100000)} ${tally}`);
tally = 0.5;
attempt("the sum is no integer", () => `${emitThree(1000)} ${tally}`);
tally = undefined;
attempt("the sum starts undefined", () => `${emitThree(1000)} ${tally}`);
tally = 10n;
attempt("the sum starts as a bigint", () => `${emitThree(1000)} ${tally}`);
tally = { valueOf() { heard++; return 1; } };
attempt("the sum starts as an object", () => `${emitThree(1000)} ${tally}`);
