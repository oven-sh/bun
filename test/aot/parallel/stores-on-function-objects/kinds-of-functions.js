// Stores and Object.assign on every kind of function object, with the default prototype and below an object.
const log = [];
const Kind = { tag: "kind", describe() { return "described " + this.alpha; } };
class Base { static inherited = "base"; static set watched(value) { log.push("watched " + value); } }
const makers = {
  plain: () => function plain() {},
  arrow: () => () => 1,
  async: () => async function later() {},
  asyncArrow: () => async () => 1,
  generator: () => function* steps() {},
  asyncGenerator: () => async function* flows() {},
  klass: () => class Klass { static own = 1; },
  derived: () => class Derived extends Base {},
  bound: () => function target() {}.bind(null),
  method: () => ({ method() {} }).method,
  getter: () => Object.getOwnPropertyDescriptor({ get value() { return 1; } }, "value").get,
  native: () => Math.max.bind(Math),
};
for (let round = 0; round < 3; round++) {
  for (const [label, maker] of Object.entries(makers)) {
    for (const below of [false, true]) {
      const made = maker();
      if (below) Object.setPrototypeOf(made, Kind);
      made.alpha = round; made.watched = round; made.inherited = "own";
      Object.assign(made, { beta: label, alpha: round + 1 });
      log.push([label, below, Object.keys(made).join(), made.alpha, made.beta, made.inherited, below ? made.describe() : typeof made.describe, typeof made].join(" "));
    }
  }
}
console.log(log.join("\n"));
