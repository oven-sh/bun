// Object.assign stores with [[Set]]: a setter or a read-only property on the target's prototype chain is honored, also when it appears after earlier calls.
"use strict";
const log = [];
const proto = { kind: "p" };
const above = {};
Object.setPrototypeOf(proto, above);
function run(label) {
  try {
    const made = Object.assign(Object.create(proto), { alpha: 1, beta: 2 });
    log.push(label + " " + JSON.stringify(made) + " " + Object.keys(made).join());
  } catch (error) {
    log.push(label + " " + error.name);
  }
}
for (let round = 0; round < 4; round++) run("plain" + round);
Object.defineProperty(proto, "alpha", { set(value) { log.push("setter alpha " + value); }, configurable: true });
for (let round = 0; round < 3; round++) run("setter" + round);
delete proto.alpha;
for (let round = 0; round < 3; round++) run("deleted" + round);
Object.defineProperty(above, "beta", { value: 7, writable: false, configurable: true });
for (let round = 0; round < 3; round++) run("readonly" + round);
delete above.beta;
Object.defineProperty(above, "beta", { set(value) { log.push("setter beta " + value); }, configurable: true });
for (let round = 0; round < 3; round++) run("above" + round);
delete above.beta;
for (let round = 0; round < 3; round++) run("end" + round);
console.log(log.join("\n"));
