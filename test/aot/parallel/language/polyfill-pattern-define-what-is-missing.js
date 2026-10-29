// In the manner of the export helper of core-js: it takes a target and a set of members, skips each key that the target has, and defines the rest under computed keys. What a current engine lacks is added, and what it has stays the original.
function install({ target, proto }, members) {
  const object = proto ? globalThis[target].prototype : globalThis[target];
  const installed = [];
  for (const key of Reflect.ownKeys(members)) {
    if (key in object) continue;
    Object.defineProperty(object, key, { value: members[key], enumerable: false, writable: true, configurable: true });
    installed.push(String(key));
  }
  console.log(target + (proto ? ".prototype" : "") + ": " + installed.join(" "));
}

const originals = [Array.prototype.at, Array.prototype.includes, String.prototype.padStart, Promise.all, Symbol.iterator, Function.prototype.call, Iterator.prototype.map, Map.prototype.get];
const marker = Symbol("marker");

install({ target: "Array", proto: true }, {
  at() { return "never installed"; },
  includes() { return "never installed"; },
  lastItemOfTheProgram() { return this[this.length - 1]; },
  groupedByTheProgram(keyOf) { const groups = {}; for (const value of this) (groups[keyOf(value)] ??= []).push(value); return groups; },
  [marker]: "array",
});
install({ target: "String", proto: true }, { padStart() { return "never installed"; }, shoutedByTheProgram() { return this.toUpperCase() + "!"; } });
install({ target: "Promise" }, { all() { return "never installed"; }, allKeyedByTheProgram(promises) { return Promise.all(Object.values(promises)).then(values => Object.fromEntries(Object.keys(promises).map((key, index) => [key, values[index]]))); } });
install({ target: "Symbol" }, { iterator: "never installed", useSetter() {}, useSimple() {} });
install({ target: "Function", proto: true }, { call() { return "never installed"; }, demethodize() { const method = this; return (receiver, ...rest) => method.apply(receiver, rest); }, [marker]: "function" });
install({ target: "Iterator", proto: true }, { map() { return "never installed"; }, countedByTheProgram() { let count = 0; for (const value of this) count++; return count; } });
install({ target: "Map", proto: true }, { get() { return "never installed"; }, toJSON() { return [...this]; } });

console.log([Array.prototype.at, Array.prototype.includes, String.prototype.padStart, Promise.all, Symbol.iterator, Function.prototype.call, Iterator.prototype.map, Map.prototype.get].every((member, index) => member === originals[index]));
console.log([[1, 2, 3].lastItemOfTheProgram(), JSON.stringify([1, 2, 3].groupedByTheProgram(value => (value % 2 ? "odd" : "even"))), [][marker], "abc".shoutedByTheProgram(), JSON.stringify(await Promise.allKeyedByTheProgram({ a: 1, b: Promise.resolve(2) })), typeof Symbol.useSetter, [].slice.demethodize()([1, 2, 3], 1).join(), (() => 1)[marker], [1, 2].values().countedByTheProgram(), JSON.stringify(new Map([[1, 2]]))].join(" "));
console.log([[1, 2, 3].at(-1), [1, 2].includes(2), "7".padStart(3, "0"), (await Promise.all([1, 2])).join(), [...[1, 2].values().map(value => value * 2)].join(), new Map([[1, 2]]).get(1)].join(" "));
