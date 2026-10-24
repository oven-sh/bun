// Impostors arrays generators: bodies arrays and their impostors are converted. It prints what plain Bun prints.
const log = [];

const uses = {
  //group to-text
  text: list => "" + list,
  template: list => `${list}`,
  string: list => String(list),
  plusOne: list => list + 1,
  looseText: list => list == "3,1,2",
  asAKey: list => ({ "3,1,2": "found", 3: "found three", "": "found nothing" })[list],
  joinedInto: list => [list, list].join(";"),
  json: list => JSON.stringify({ list }),
  sortedAmong: list => [10, list, 2].sort().map(String),
  parsed: list => parseInt(list),
  inADate: list => new Date(list).getTime() === new Date(String(list)).getTime(),
  //group to-numbers-and-booleans
  number: list => +list,
  times: list => list * 2,
  minusOne: list => list - 1,
  looseNumber: list => list == 3,
  looseItself: list => list == list,
  less: list => list < 4,
  truthy: list => (list ? "truthy" : "falsy"),
  not: list => !list,
  bits: list => list | 0,
  largest: list => Math.max(list),
  isNaN: list => isNaN(list),
};

const makers = {
  "an array": () => [3, 1, 2],
  "an array of one": () => [3],
  "an empty array": () => [],
  "an array of an array": () => [[3]],
  "an array of null and undefined": () => [null, undefined],
  "an array with a hole": () => [3, , 2],
  "an array that holds itself": () => { const list = [3]; list.push(list); return list; },
  "an array with its own toString": () => Object.assign([3, 1, 2], { toString() { log.push("toString"); return "own text"; } }),
  "an array with its own join": () => Object.assign([3, 1, 2], { join() { log.push("join"); return "own join"; } }),
  "an array whose join is no function": () => Object.assign([3, 1, 2], { join: 5 }),
  "an array with its own valueOf": () => Object.assign([3, 1, 2], { valueOf() { log.push("valueOf"); return 42; } }),
  "an array with its own primitive": () => Object.assign([3, 1, 2], { [Symbol.toPrimitive](hint) { log.push(hint); return hint === "number" ? 42 : "primitive"; } }),
  "an array with its own toJSON": () => Object.assign([3, 1, 2], { toJSON() { log.push("toJSON"); return "own JSON"; } }),
  "an array under null": () => Object.setPrototypeOf([3, 1, 2], null),
  "a subclass with a join": () => new (class extends Array { join() { log.push("join"); return "the subclass's join"; } })(3, 1, 2),
  "an array of objects with toString": () => [{ toString() { log.push("element"); return "e"; } }, 1],
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array-like under Array.prototype": () => ({ __proto__: Array.prototype, 0: 3, 1: 1, 2: 2, length: 3 }),
  "a typed array": () => new Uint8Array([3, 1, 2]),
  "a typed array of one": () => new Uint8Array([3]),
  "a Set": () => new Set([3]),
  "arguments": () => (function () { return arguments; })(3, 1, 2),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "a string": () => "3,1,2",
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([3, 1, 2]);

for (const name in makers) {
  for (const use in uses) {
    log.length = 0;
    let answer;
    try {
      answer = describe(uses[use](makers[name]()));
    } catch (error) {
      answer = "threw " + error.constructor.name;
    }
    console.log(name + ", " + use + ": " + answer + (log.length ? " after " + log.join(", ") : ""));
  }
}
