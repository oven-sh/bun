// Object.assign may remember how it copied. A change anywhere on the target's prototype chain after earlier copies is honored. The target is a function object.
const log = [];
class Klass { method() {} }
const chains = {
  literals: () => [{ top: 1 }, { kind: 1 }],
  parsed: () => [JSON.parse('{"top":1}'), JSON.parse('{"kind":1}')],
  bare: () => [Object.create(null), Object.create(null)],
  classes: () => [class Upper { upper() {} }.prototype, class Lower { lower() {} }.prototype],
  functions: () => [function top() {}, function kind() {}],
  mixed: () => [JSON.parse('{"top":1}'), { kind: 1 }],
};
for (const [label, links] of Object.entries(chains)) {
  const [Top, Kind] = links();
  const aboveTop = Object.getPrototypeOf(Top);
  Object.setPrototypeOf(Kind, Top);
  const Trap = { set beta(value) { log.push("trap beta " + value); }, trapped: true };
  const run = step => {
    for (let round = 0; round < 3; round++) {
      const target = Object.setPrototypeOf(function made() {}, Kind);
      try {
        Object.assign(target, { alpha: round, beta: 2 }, { gamma: 3 });
        log.push(label + " " + step + round + " " + Object.keys(target) + " " + target.alpha + " " + target.beta + " " + target.gamma);
      } catch (error) {
        log.push(label + " " + step + round + " " + error.name + " " + Object.keys(target));
      }
    }
  };
  run("start");
  Object.defineProperty(Kind, "alpha", { set(value) { log.push("setter alpha " + value); }, configurable: true });
  run("setter");
  delete Kind.alpha;
  run("deleted");
  Object.defineProperty(Top, "gamma", { value: "fixed", writable: false, configurable: true });
  run("read-only");
  delete Top.gamma;
  run("deleted again");
  Object.setPrototypeOf(Kind, Trap);
  run("trap above kind");
  Object.setPrototypeOf(Kind, Top);
  run("restored");
  Object.setPrototypeOf(Top, Trap);
  run("trap above top");
  Object.setPrototypeOf(Top, aboveTop);
  run("restored again");
  Kind.beta = "data above";
  run("data above");
  Object.freeze(Kind);
  run("frozen above");
}
console.log(log.join("\n"));
