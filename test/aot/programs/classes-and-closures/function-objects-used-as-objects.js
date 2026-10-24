"use strict";

const kinds = {
  arrow: box => a => box.n + a,
  plain: box =>
    function plain(a, b, c) {
      if (this) this.constructedWith = box.n;
      return box.n + a;
    },
  async: box =>
    async function asynchronous(a) {
      return box.n + a;
    },
  bound: box => {
    function target(a, b) {
      return (this?.base ?? 0) + box.n + a;
    }
    return target.bind({ base: 100 });
  },
};

const names = f => Object.getOwnPropertyNames(f).join();
const attempt = action => {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
};
const hasOwn = (f, name) => Object.prototype.hasOwnProperty.call(f, name);

const steps = [
  ["call", f => [typeof f, f(5) instanceof Promise]],
  ["length and name", f => [f.length, f.name, f.length, f.name]],
  ["own names", f => [names(f)]],
  ["absent property", f => ["x" in f, f.x, names(f)]],
  ["index", f => [f[0], 0 in f, names(f)]],
  ["delete index", f => [delete f[0], names(f)]],
  ["delete name", f => [delete f.name, f.name, hasOwn(f, "name"), names(f)]],
  ["store", f => [(f.x = 1), Object.keys(f).join(), f.x, names(f)]],
  ["store index", f => [(f[0] = 7), f[0], Object.keys(f).join(), names(f)]],
  ["define", f => {
    Object.defineProperty(f, "y", { value: 2, enumerable: true });
    return [f.y, Object.keys(f).join(), JSON.stringify(Object.getOwnPropertyDescriptor(f, "y"))];
  }],
  ["define name", f => {
    Object.defineProperty(f, "name", { value: "renamed" });
    return [f.name, JSON.stringify(Object.getOwnPropertyDescriptor(f, "name"))];
  }],
  ["prevent extensions", f => [Object.isExtensible(Object.preventExtensions(f)), Reflect.set(f, "z", 1), f.z, names(f)]],
  ["is extensible", f => [Object.isExtensible(f), names(f)]],
  ["freeze", f => [Object.isFrozen(Object.freeze(f)), Reflect.set(f, "z", 1), names(f)]],
  ["set prototype", f => {
    const p = { through() { return "through p"; } };
    Object.setPrototypeOf(f, p);
    return [f.through(), typeof f.call, Object.getPrototypeOf(f) === p, names(f)];
  }],
  ["same prototype", f => [Object.setPrototypeOf(f, Object.getPrototypeOf(f)) === f, names(f)]],
  ["prototype property", f => [typeof f.prototype, hasOwn(f, "prototype"), f.prototype?.constructor === f]],
  ["new, then prototype store", f => attempt(() => {
    const before = new f(1);
    const q = { marker: "q" };
    f.prototype = q;
    const after = new f(1);
    return [Object.getPrototypeOf(before) === q, before.marker, Object.getPrototypeOf(after) === q, after.marker];
  })],
  ["prototype store, then new", f => attempt(() => {
    const q = { marker: "q" };
    f.prototype = q;
    const after = new f(1);
    return [Object.getPrototypeOf(after) === q, after.marker];
  })],
  ["instanceof", f => [attempt(() => ({}) instanceof f), attempt(() => 1 instanceof f), attempt(() => new f(1) instanceof f)]],
  ["weak map key", f => {
    const map = new WeakMap();
    map.set(f, "value");
    return [map.get(f), map.has(f), names(f)];
  }],
  ["prototype of object", f => {
    const child = Object.create(f);
    child.x = 1;
    return [typeof child, child.length, child.name, child.x, Reflect.set(child, "name", "other"), Object.getPrototypeOf(child) === f, names(f)];
  }],
];

const printed = [];
let differences = 0;
let position = 0;
function report(round, line) {
  if (!round) {
    printed.push(line);
    console.log(line);
  } else if (printed[position] !== line) {
    differences++;
    console.log(`round ${round}: ${line}`);
  }
  position++;
}

async function main() {
  for (let round = 0; round < 3; round++) {
    position = 0;
    for (const [kind, make] of Object.entries(kinds)) {
      const cells = Array.from({ length: 200 }, (_, n) => make({ n }));
      const offset = kind === "bound" ? 100 : 0;
      for (let i = 0; i < steps.length; i++) {
        const [label, step] = steps[i];
        const f = cells[i];
        const result = attempt(() => step(f));
        report(round, `${kind} ${label}: ${[].concat(result).map(String).join(" | ")}; call ${await f(1)}`);
        if (i % 8 === 0) Bun.gc(true);
      }
      Bun.gc(true);
      let wrong = 0;
      for (let n = 0; n < cells.length; n++) {
        const f = cells[n];
        if ((await f(1)) !== n + 1 + offset) wrong++;
      }
      report(round, `${kind} after collection: ${wrong} wrong`);
    }
  }
  console.log(`differences between rounds: ${differences}`);
}

main();
