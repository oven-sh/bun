// An object of the program escapes, and then gets another prototype through a value that the compiler cannot follow. Native code that converts it, walks it, awaits it
// or writes it out finds the members of that prototype by name.
const hide = value => new CustomEvent("x", { detail: value }).detail;
const hook = globalThis[process.argv[9] ?? "noSuchHook"];
function show(it) {
  hook?.(it);
  return it;
}
const said = act => {
  try {
    const answer = act();
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  } catch (error) {
    return error.name;
  }
};
const below = prototype => Object.setPrototypeOf(show({ length: 1, 0: "z", source: "s", flags: "g", message: "m", name: "n" }), hide(prototype));

const prototypes = {
  Map: Map.prototype,
  Set: Set.prototype,
  Array: Array.prototype,
  String: String.prototype,
  Number: Number.prototype,
  Boolean: Boolean.prototype,
  BigInt: BigInt.prototype,
  Symbol: Symbol.prototype,
  Function: Function.prototype,
  Iterator: Iterator.prototype,
  Uint8Array: Uint8Array.prototype,
  Date: Date.prototype,
  RegExp: RegExp.prototype,
  Error: Error.prototype,
  Promise: Promise.prototype,
  URL: URL.prototype,
  Locale: Intl.Locale.prototype,
  Global: WebAssembly.Global.prototype,
  arrayIterator: Object.getPrototypeOf([].values()),
  mapIterator: Object.getPrototypeOf(new Map().entries()),
  generator: Object.getPrototypeOf((function* () {})()),
  helper: Object.getPrototypeOf([].values().map(value => value)),
  wrapped: Object.getPrototypeOf(Iterator.from({ next() {} })),
};
for (const [name, prototype] of Object.entries(prototypes)) {
  console.log(
    name,
    "|", said(() => `${below(prototype)}`),
    "|", said(() => below(prototype) + 1),
    "|", said(() => below(prototype) * 2),
    "|", said(() => Array.from(below(prototype))),
    "|", said(() => [...new Set(below(prototype))]),
    "|", said(() => JSON.stringify(below(prototype))),
    "|", said(() => Object.fromEntries(below(prototype))),
    "|", said(() => [below(prototype)].join()),
  );
}
for (const [name, prototype] of Object.entries(prototypes)) {
  let answer;
  try {
    answer = typeof (await below(prototype));
  } catch (error) {
    answer = error.name;
  }
  console.log("await", name, answer);
}
