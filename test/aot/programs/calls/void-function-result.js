const log = [];
let counter = 0;

function bump() {
  counter++;
}
function bumpTwice() {
  bump();
  bump();
}
function bumpInTailPosition() {
  return bump();
}
function bumpOrNumber(flag) {
  if (flag) return bump();
  return 7;
}
function earlyReturn(flag) {
  if (flag) return;
  counter += 10;
}
function neverReturns() {
  throw new Error("thrown");
}
const arrow = () => {
  counter++;
};
const holder = {
  method() {
    counter++;
  },
  forward() {
    return this.method();
  },
};
class Counter {
  static reset() {
    counter = 0;
  }
  step() {
    counter++;
  }
}

const show = value => (value === undefined ? "undefined" : typeof value + " " + String(value));
const indirect = [bump, bumpTwice, bumpInTailPosition, earlyReturn, arrow, holder.method, holder.forward.bind(holder), Counter.reset, Counter.prototype.step];

for (let round = 0; round < 3; round++) {
  log.push("direct " + [bump(), bumpTwice(), bumpInTailPosition(), bumpOrNumber(true), bumpOrNumber(false), earlyReturn(true), earlyReturn(false), arrow(), holder.method(), holder.forward(), Counter.reset(), new Counter().step()].map(show).join(","));
  log.push("indirect " + indirect.map(f => show(f())).join(","));
  log.push("call " + indirect.map(f => show(f.call(holder))).join(","));
  log.push("apply " + indirect.map(f => show(f.apply(holder, [false]))).join(","));
  log.push("reflect " + indirect.map(f => show(Reflect.apply(f, holder, []))).join(","));
  log.push("bound " + indirect.map(f => show(f.bind(holder)())).join(","));
  log.push("callbacks " + show([1, 2, 3].forEach(bump)) + " " + [1, 2].map(bump).map(show).join(",") + " " + [1, 2].filter(bump).length + " " + show([1].find(bump)) + " " + [3, 1, 2].sort(bump).join(""));
  log.push("operators " + (bump() ?? "nullish") + " " + (bump() || "falsy") + " " + String(bump() && "truthy") + " " + (bump() === undefined) + " " + typeof bump() + " " + `${bump()}` + " " + (bump() + 1) + " " + JSON.stringify({ a: bump(), b: [bump()] }));
  log.push("default " + ((value = "defaulted") => value)(bump()));
  log.push("spread " + [...[bump(), bump()]].map(show).join(","));
  log.push("new " + typeof new bump() + " " + (new bumpInTailPosition() instanceof bumpInTailPosition));
  try {
    neverReturns();
  } catch (error) {
    log.push("throws " + error.message);
  }
  try {
    indirect.concat(neverReturns).forEach(f => f());
  } catch (error) {
    log.push("throws indirectly " + error.message);
  }
}

async function asyncVoid() {
  counter++;
}
function* generatorVoid() {
  counter++;
}
function thenable() {
  return Promise.resolve().then(bump);
}
Promise.all([asyncVoid(), thenable(), Promise.resolve(1).then(bumpInTailPosition), new Promise(resolve => resolve(bump()))]).then(values => {
  log.push("promises " + values.map(show).join(","));
  log.push("generator " + JSON.stringify(generatorVoid().next()));
  log.push("counter " + counter);
  console.log(log.join("\n"));
});
