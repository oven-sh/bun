import sloppy from "./sloppy.cjs";

function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
}

// `named` has an export for each thing that is asked under a name.
export function ask(kind, frozen, sealed, tested, listed, named, untouched) {
  const say = (what, action) => console.log(`${kind}: ${what}: ${attempt(action)}`);

  say("Object.freeze", () => Object.freeze(frozen) === frozen);
  say("Object.seal", () => Object.seal(sealed) === sealed);
  say("Object.isFrozen", () => Object.isFrozen(tested));
  say("Object.isSealed", () => Object.isSealed(tested));
  say("Object.preventExtensions", () => Object.preventExtensions(untouched) === untouched);
  say("Reflect.preventExtensions", () => Reflect.preventExtensions(untouched));
  say("Object.isExtensible", () => Object.isExtensible(untouched));

  say(
    "Object.defineProperty, the same value",
    () => Object.defineProperty(named, "definedAsItIs", { value: 1 }) === named,
  );
  say(
    "Object.defineProperty, another value",
    () => Object.defineProperty(named, "definedAnew", { value: 2 }) === named,
  );
  say(
    "Object.defineProperty, read-only",
    () => Object.defineProperty(named, "definedReadOnly", { writable: false }) === named,
  );
  say("Object.defineProperty, a new name", () => Object.defineProperty(named, "missing", { value: 1 }) === named);
  say("Reflect.defineProperty, the same value", () =>
    Reflect.defineProperty(named, "askedToDefineAsItIs", { value: 1 }),
  );
  say("Reflect.defineProperty, another value", () => Reflect.defineProperty(named, "askedToDefineAnew", { value: 2 }));
  say("Reflect.set", () => Reflect.set(named, "askedToSet", 1));
  say("Reflect.deleteProperty", () => Reflect.deleteProperty(named, "askedToDelete"));
  say("Reflect.deleteProperty, a new name", () => Reflect.deleteProperty(named, "missing"));

  say("a store in strict code", () => (named.storedByStrictCode = 2));
  say("a store in sloppy code", () => sloppy.store(named));
  say("delete in strict code", () => delete named.deletedByStrictCode);
  say("delete in sloppy code", () => sloppy.remove(named));
  say("delete of a new name", () => delete named.missing);

  say("Object.getOwnPropertyDescriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(named, "described")));
  say("Object.getOwnPropertyDescriptor, a new name", () => Object.getOwnPropertyDescriptor(named, "missing"));
  say("in", () => "lookedFor" in named);
  say("in, a new name", () => "missing" in named);

  say("Object.keys", () => Object.keys(listed).join());
  say("Reflect.ownKeys", () => Reflect.ownKeys(listed).map(String).join());
  say("Object.getOwnPropertyDescriptors", () => JSON.stringify(Object.getOwnPropertyDescriptors(listed)));

  say("Symbol.toStringTag", () => JSON.stringify(Object.getOwnPropertyDescriptor(untouched, Symbol.toStringTag)));
  say("Object.prototype.toString", () => Object.prototype.toString.call(untouched));
  say("Object.getPrototypeOf", () => typeof Object.getPrototypeOf(untouched));
  say("Object.setPrototypeOf, null", () => Object.setPrototypeOf(untouched, null) === untouched);
  say("Object.setPrototypeOf, an object", () => Object.setPrototypeOf(untouched, {}) === untouched);
  say("Reflect.setPrototypeOf", () =>
    [Reflect.setPrototypeOf(untouched, null), Reflect.setPrototypeOf(untouched, {})].join(),
  );
}
