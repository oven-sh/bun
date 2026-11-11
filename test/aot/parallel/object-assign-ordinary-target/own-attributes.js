// Own properties that the target already has keep their attributes and their place; read-only ones throw, accessors are called.
"use strict";
const proto = { kind: "p" };
function describe(object) {
  return Object.entries(Object.getOwnPropertyDescriptors(object)).map(([key, d]) => key + ":" + ("value" in d ? d.value : "accessor") + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-")).join(" ");
}
function run(label, prepare) {
  const target = Object.create(proto);
  prepare(target);
  try {
    console.log(label, describe(Object.assign(target, { alpha: 1, beta: 2, gamma: 3 })));
  } catch (error) {
    console.log(label, error.name, describe(target));
  }
}
for (let round = 0; round < 4; round++) {
  run("empty", () => {});
  run("has beta", target => { target.beta = 0; });
  run("hidden beta", target => Object.defineProperty(target, "beta", { value: 0, writable: true, enumerable: false, configurable: true }));
  run("fixed beta", target => Object.defineProperty(target, "beta", { value: 0, writable: true, enumerable: true, configurable: false }));
  run("read-only beta", target => Object.defineProperty(target, "beta", { value: 0, writable: false, enumerable: true, configurable: true }));
  run("setter beta", target => Object.defineProperty(target, "beta", { set(value) { console.log("own setter", value); }, enumerable: true, configurable: true }));
  run("getter alone", target => Object.defineProperty(target, "beta", { get() { return 5; }, enumerable: true, configurable: true }));
}
