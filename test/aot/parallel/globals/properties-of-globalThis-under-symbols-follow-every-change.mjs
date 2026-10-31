// `globalThis[symbol]`, read and stored again and again, for a symbol the program makes, a registered one and a well-known one, while other code changes the property.
import vm from "node:vm";

const created = Symbol("created");
const registered = Symbol.for("a registry of this test");

const properties = {
  created: {
    read: () => globalThis[created],
    store: value => {
      globalThis[created] = value;
    },
    has: () => created in globalThis,
    kind: () => typeof globalThis[created],
    define: descriptor => Object.defineProperty(globalThis, created, descriptor),
    remove: () => delete globalThis[created],
    storeFromOutside: value => Reflect.set(globalThis, created, value),
  },
  registered: {
    read: () => globalThis[registered],
    store: value => {
      globalThis[registered] = value;
    },
    has: () => registered in globalThis,
    kind: () => typeof globalThis[registered],
    define: descriptor => Object.defineProperty(globalThis, registered, descriptor),
    remove: () => delete globalThis[registered],
    storeFromOutside: value =>
      vm.runInThisContext(`globalThis[Symbol.for("a registry of this test")] = ${JSON.stringify(value)}; true`),
  },
  spelledOut: {
    read: () => globalThis[Symbol.for("spelled out at every use")],
    store: value => {
      globalThis[Symbol.for("spelled out at every use")] = value;
    },
    has: () => Symbol.for("spelled out at every use") in globalThis,
    kind: () => typeof globalThis[Symbol.for("spelled out at every use")],
    define: descriptor => Object.defineProperty(globalThis, Symbol.for("spelled out at every use"), descriptor),
    remove: () => delete globalThis[Symbol.for("spelled out at every use")],
    storeFromOutside: value =>
      vm.runInThisContext(`globalThis[Symbol.for("spelled out at every use")] = ${JSON.stringify(value)}; true`),
  },
  wellKnown: {
    read: () => globalThis[Symbol.unscopables],
    store: value => {
      globalThis[Symbol.unscopables] = value;
    },
    has: () => Symbol.unscopables in globalThis,
    kind: () => typeof globalThis[Symbol.unscopables],
    define: descriptor => Object.defineProperty(globalThis, Symbol.unscopables, descriptor),
    remove: () => delete globalThis[Symbol.unscopables],
    storeFromOutside: value => vm.runInThisContext(`globalThis[Symbol.unscopables] = ${JSON.stringify(value)}; true`),
  },
};

function attempt(action, value) {
  try {
    const result = action(value);
    return result === undefined ? "undefined" : String(result);
  } catch (error) {
    return error.constructor.name;
  }
}
function repeat(action, value) {
  let outcome;
  for (let i = 0; i < 60; i++) outcome = attempt(action, value === undefined ? undefined : value + " " + i);
  return outcome;
}

for (const name in properties) {
  const property = properties[name];
  const tell = what =>
    console.log(name + ", " + what + ":", repeat(property.read), repeat(property.has), repeat(property.kind));

  tell("absent");
  property.storeFromOutside("from outside");
  tell("made by other code");
  console.log("stores:", repeat(property.store, "stored"));
  tell("stored");
  property.storeFromOutside("from outside again");
  tell("replaced by other code");
  property.remove();
  tell("deleted");
  console.log("stores:", repeat(property.store, "made by the store"));
  tell("made by the store");

  let reads = 0;
  let given = "nothing";
  property.define({
    get() {
      return "read " + ++reads;
    },
    set(value) {
      given = value + (this === globalThis ? "" : ", with another this");
    },
    configurable: true,
  });
  tell("accessor");
  console.log("stores:", repeat(property.store, "to the setter"), given);
  property.define({ value: "fixed", writable: false, configurable: true });
  tell("read only");
  console.log("stores:", repeat(property.store, "refused"));
  tell("still read only");
  property.define({ value: "open", writable: true, configurable: true });
  console.log("stores:", repeat(property.store, "open again"));
  tell("writable again");

  Bun.gc(true);
  let kept = 0;
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 100; i++) property.store({ round, i, filler: [round, i, "text " + i] });
    Bun.gc(false);
    const garbage = [];
    for (let i = 0; i < 500; i++) garbage.push({ i, text: "garbage " + i });
    const held = property.read();
    if (held.round === round && held.i === 99 && held.filler[2] === "text 99") kept++;
  }
  console.log("kept over collections", kept);
  property.remove();
  tell("deleted at the end");
}

Object.freeze(globalThis);
for (const name in properties)
  console.log(name + ", frozen:", repeat(properties[name].store, "late"), repeat(properties[name].read));
