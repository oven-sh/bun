function kindOfCaller() {
  return this === undefined ? "strict" : "sloppy";
}
(globalThis.kinds ??= []).push(kindOfCaller());
