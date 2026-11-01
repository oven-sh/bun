// `holder.table.name` in a loop that does nothing else to objects. The holder is a module's `const`, so the loop may run before it has a value; the table is whatever the holder holds at the time.
import { EventEmitter } from "node:events";

function attempt(mark, run) {
  try {
    console.log(mark + ":", run());
  } catch (error) {
    console.log(mark + ":", error.constructor.name);
  }
}

// The text is put together when the program runs, so nobody knows ahead of time what the tables look like.
const quote = String.fromCharCode(Date.now() > 0 ? 34 : 39);
function parsed(text) {
  return JSON.parse(text.split("'").join(quote));
}

class Holder {
  constructor(table) {
    this.table = table;
  }
  stepOf() {
    const step = this.table?.step;
    if (step === undefined) return 0;
    if (typeof step === "function") return 1;
    return typeof step === "number" ? step : 2;
  }
}

function turn(i) {
  return holder.stepOf() + (i & 1);
}
function sum(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total = (total + turn(i)) | 0;
  return total;
}

const nameOfStep = "step" + (Date.now() > 0 ? "" : "s");
const table = parsed("{'step': 0}");
table[nameOfStep] = () => {};
const holder = new Holder(table);

// The site has seen nothing yet, and the loop is entered once.
attempt("the first loop of all", () => sum(5000));
for (let i = 0; i < 200; i++) sum(10);
attempt("a function", () => sum(1000));
attempt("no turn", () => sum(0));
attempt("a bound with a fraction", () => sum(10.5));
attempt("a bound that is no number of turns", () => sum(NaN));
attempt("a bound below nothing", () => sum(-3));
attempt("a bound past the integers", () => {
  let total = 0;
  for (let i = 4294967290; i < 4294967300; i++) total = (total + turn(i)) | 0;
  return total;
});

table[nameOfStep] = [1, 2, 3];
attempt("a list in the same place", () => sum(1000));
table[nameOfStep] = "four";
attempt("a text", () => sum(1000));
table[nameOfStep] = 7;
attempt("a number", () => sum(1000));
table[nameOfStep] = 0.5;
attempt("a fraction", () => sum(1000));
table[nameOfStep] = undefined;
attempt("undefined", () => sum(1000));
table[nameOfStep] = null;
attempt("null", () => sum(3));
delete table[nameOfStep];
attempt("deleted", () => sum(1000));
for (let i = 0; i < 200; i++) sum(10);
attempt("still deleted", () => sum(1000));
table[nameOfStep] = [1];
attempt("back again", () => sum(1000));

holder.table = parsed("{'other': 0, 'step': [1, 2]}");
attempt("another table", () => sum(1000));
for (let i = 0; i < 200; i++) sum(10);
holder.table = Object.create(parsed("{'step': [1, 2, 3, 4]}"));
attempt("a table that finds it above", () => sum(1000));
holder.table = null;
attempt("no table", () => sum(1000));
holder.table = undefined;
attempt("a table that is undefined", () => sum(1000));
delete holder.table;
attempt("the holder has lost it", () => sum(1000));
Holder.prototype.table = parsed("{'step': [1, 2, 3, 4, 5]}");
attempt("the holder finds one above", () => sum(1000));
delete Holder.prototype.table;
holder.table = 7;
attempt("a number for a table", () => sum(1000));
holder.table = "text";
attempt("a text for a table", () => sum(1000));

// A holder of its own for what runs code in the middle of a loop, and for loops that run before there is a holder: the loop above stays one that only reads.
class OddHolder {
  constructor(table) {
    this.table = table;
  }
  stepOf() {
    const step = this.table?.step;
    if (step === undefined) return 0;
    if (typeof step === "function") return 1;
    return typeof step === "number" ? step : 2;
  }
}
function oddTurn(i) {
  return oddHolder.stepOf() + (i & 1);
}
function oddSum(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total = (total + oddTurn(i)) | 0;
  return total;
}
attempt("no turn before the holder is there", () => oddSum(0));
attempt("one turn before the holder is there", () => oddSum(1));
attempt("many turns before the holder is there", () => oddSum(1000));

const oddHolder = new OddHolder(parsed("{'step': [1]}"));
for (let i = 0; i < 200; i++) oddSum(10);
attempt("once the holder is there", () => oddSum(1000));

let reads = 0;
oddHolder.table = Object.defineProperty(parsed("{'other': 1}"), nameOfStep, {
  get() {
    reads++;
    if (reads === 500) oddHolder.table = parsed("{'step': [1, 2, 3, 4, 5, 6]}");
    return [1];
  },
});
attempt("a getter that gives the holder another table", () => oddSum(1000) + " after " + reads);
attempt("the table it gave", () => oddSum(1000) + " after " + reads);

let asked = 0;
oddHolder.table = new Proxy(parsed("{'step': [1, 2]}"), {
  get(target, key) {
    asked++;
    return target[key];
  },
});
attempt("a proxy", () => oddSum(100) + " after " + asked);

// The same with the library's own holder of tables.
const emitter = new EventEmitter();
function count(turns) {
  let total = 0;
  for (let i = 0; i < turns; i++) total = (total + emitter.listenerCount("tick") + (i & 1)) | 0;
  return total;
}
attempt("nobody listens", () => count(1000));
const first = () => {};
emitter.on("tick", first);
attempt("one listens", () => count(1000));
for (let i = 0; i < 200; i++) count(10);
attempt("one still listens", () => count(1000));
emitter.on("tick", () => {});
attempt("two listen", () => count(1000));
emitter.on("tock", () => {});
attempt("somebody listens to something else", () => count(1000));
emitter.off("tick", first);
attempt("one has left", () => count(1000));
emitter.removeAllListeners("tick");
attempt("all have left", () => count(1000));
emitter.once("tick", () => {});
attempt("one listens once", () => count(1000));
emitter.emit("tick");
attempt("it has heard", () => count(1000));
emitter.removeAllListeners();
attempt("nobody listens to anything", () => count(1000));
emitter._events = undefined;
attempt("no table of listeners", () => count(1000));
emitter._events = parsed("{'tick': [1, 2, 3]}");
attempt("a table put there by hand", () => count(1000));
emitter.listenerCount = () => 9;
attempt("a count of its own", () => count(1000));
delete emitter.listenerCount;
attempt("without it again", () => count(1000));
