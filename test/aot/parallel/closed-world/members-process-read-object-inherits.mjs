// An object that inherits from `process` goes to a function that the compiler cannot follow, or behind a Proxy. Whoever gets it back reads the members of `process` through it under computed keys.
const unknown = globalThis[["Obj", "ect"].join("")];
const computed = text => text.split("").join("");
const heirs = {
  created: () => Object.create(process),
  createdTwice: () => Object.create(Object.create(process)),
  linked: () => Object.setPrototypeOf({}, process),
  literal: () => ({ __proto__: process }),
};
const hands = {
  handedBack: heir => unknown(heir),
  behindProxy: heir => new Proxy(heir, {}),
  heldByAnother: heir => unknown({ heir }).heir,
};
for (const [heirName, make] of Object.entries(heirs)) {
  for (const [handName, hand] of Object.entries(hands)) {
    const holder = hand(make());
    const read = [];
    for (const key of [
      "stdout",
      "stderr",
      "stdin",
      "allowedNodeEnvironmentFlags",
      "env",
      "versions",
      "hrtime",
      "finalization",
    ]) {
      const value = holder[computed(key)];
      read.push(key + " " + typeof value + (typeof value === "function" ? " " + value.length : ""));
    }
    console.log(heirName, handName, read.join());
  }
}
