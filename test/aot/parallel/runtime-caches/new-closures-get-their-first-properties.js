// Closures of every kind get properties right where they are made, elsewhere, by name and by key, and are then asked for everything a function object has: the names in their order, length, name, prototype,
// what they inherit, whether they can be called and constructed. The same place stores into closures of several functions.
const log = [];
function describe(label, made) {
  const names = Object.getOwnPropertyNames(made).join(",");
  const own = Object.getOwnPropertyDescriptor(made, "queue");
  log.push(`${label}: ${typeof made} ${names} length=${made.length} name=${JSON.stringify(made.name)} prototype=${typeof made.prototype} queue=${own ? JSON.stringify(own) : "none"} keys=${Object.keys(made)}`);
}
function plain(queue) {
  function listener(value) {
    return listener.queue.length + value;
  }
  listener.queue = queue;
  return listener;
}
function twoNames(queue) {
  function done(a, b) {
    return done.queue;
  }
  function cancel() {
    done.queue = null;
  }
  done.queue = queue;
  done.cancel = cancel;
  return done;
}
function arrow(queue) {
  const made = value => value + made.queue.length;
  made.queue = queue;
  return made;
}
function asynchronous(queue) {
  const made = async function later() {
    return made.queue;
  };
  made.queue = queue;
  return made;
}
function method(queue) {
  const made = { run() { return queue; } }.run;
  made.queue = queue;
  return made;
}
function bound(queue) {
  const made = function target(a, b, c) { return this; }.bind(queue, 1);
  made.queue = queue;
  return made;
}
function generator(queue) {
  const made = function* steps() { yield queue; };
  made.queue = queue;
  return made;
}
function untouched(queue) {
  return function later() { return queue; };
}
function storeElsewhere(made, queue) {
  made.queue = queue;
  return made;
}
function storeByKey(made, key, queue) {
  made[key] = queue;
  return made;
}
const makers = { plain, twoNames, arrow, asynchronous, method, bound, generator };
for (let round = 0; round < 40; round++) {
  for (const [label, make] of Object.entries(makers)) {
    const made = make([round]);
    if (round === 0 || round === 39) describe(label, made);
  }
  const elsewhere = storeElsewhere(round & 1 ? untouched(round) : () => round, [round]);
  const byKey = storeByKey(untouched(round), "queue", [round]);
  if (round === 0 || round >= 38) {
    describe("elsewhere", elsewhere);
    describe("by key", byKey);
  }
}
const listener = plain([1, 2]);
log.push("called " + listener(3) + " constructed " + typeof new listener(4) + " instance " + (new listener(5) instanceof listener));
const done = twoNames([1]);
done.cancel();
log.push("cancelled " + done.queue + " " + Object.keys(done));
delete done.queue;
log.push("deleted " + Object.keys(done) + " " + ("queue" in done));
for (const name of ["name", "length", "prototype", "displayName", "caller", "arguments", "toString"]) {
  const made = untouched(name);
  try {
    made[name] = "stored";
    log.push(`stored ${name}: ${String(made[name]).slice(0, 12)} own=${Object.hasOwn(made, name)}`);
  } catch (error) {
    log.push(`stored ${name}: ${error.constructor.name}`);
  }
}
const frozen = Object.freeze(untouched(0));
try {
  (function () { "use strict"; frozen.queue = 1; })();
} catch (error) {
  log.push("frozen " + error.constructor.name);
}
const heir = Object.setPrototypeOf(untouched(1), { set queue(value) { log.push("a setter above " + value); } });
heir.queue = 7;
log.push("below a setter " + Object.keys(heir).length);
console.log(log.join("\n"));
