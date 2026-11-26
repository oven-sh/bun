// The `register` and `unregister` of a FinalizationRegistry and the `deref` of a WeakRef, with the receiver as
// the first argument, as the primordials of Node have them. Script can replace those methods, and a module that
// loads after the program has run cannot capture them. `new FinalizationRegistry()` and `new WeakRef()` need
// nothing from here: the bundler reads the bare names from `@natives`.
export default $cpp("WeakReferenceFunctions.cpp", "Bun::createWeakReferenceFunctions") as {
  FinalizationRegistryPrototypeRegister<T>(
    registry: FinalizationRegistry<T>,
    target: WeakKey,
    heldValue: T,
    unregisterToken?: WeakKey,
  ): void;
  FinalizationRegistryPrototypeUnregister(registry: FinalizationRegistry<any>, unregisterToken: WeakKey): boolean;
  WeakRefPrototypeDeref<T extends WeakKey>(weakRef: WeakRef<T>): T | undefined;
};
