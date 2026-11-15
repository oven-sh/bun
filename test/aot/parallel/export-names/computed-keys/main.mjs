import * as direct from "./values.mjs";
import * as barrel from "./barrel.mjs";
import * as cycle from "./cycle.mjs";

function show(title, namespace) {
  console.log(title, Reflect.ownKeys(namespace).map(String).join());
  for (const key of Object.keys(namespace)) {
    const descriptor = Object.getOwnPropertyDescriptor(namespace, key);
    const value = namespace[key];
    console.log(" ", JSON.stringify(key), typeof value, typeof value === "function" ? value() : value, descriptor.writable, descriptor.enumerable, descriptor.configurable);
  }
}

const pieces = ["first", "second", "with", "zeta", "aaa"];
const join = (a, b) => a + b;

show("direct", direct);
show("barrel", barrel);

for (const key of [join(pieces[0], "Alone"), join(pieces[1], "Alone"), join(pieces[2], " space"), join(pieces[3], "Alone"), join(pieces[4], "Alone"), join("not", "There"), "default", "then", ""])
  console.log(JSON.stringify(key), key in direct, Object.hasOwn(direct, key), direct[key] === barrel[key], typeof direct[key], Reflect.has(barrel, key));

console.log(JSON.stringify(direct));
console.log(Object.entries(barrel).length, Object.getOwnPropertyNames(barrel).indexOf(join("second", "Alone")));

for (const key of [join("firstOf", "Cycle"), join("secondOf", "Cycle")]) {
  try {
    console.log(key, cycle.readsEarly(key));
  } catch (error) {
    console.log(error.name, error.message);
  }
}
console.log(cycle.seen.join(" | "));

try {
  const { held } = { held: direct };
  held[join("first", "Alone")] = 2;
} catch (error) {
  console.log(error.name, error.message);
}
console.log(Reflect.set(direct, join("second", "Alone"), 1), Reflect.deleteProperty(direct, join("second", "Alone")), Reflect.deleteProperty(direct, join("not", "There")));

const loaded = await import(join("./val", "ues.mjs"));
console.log(loaded === direct, loaded[join("first", "Alone")], new Function("namespace", "return [namespace.firstAlone, namespace.zetaAlone, 'aaaAlone' in namespace, Object.keys(namespace).join()].join(' ')")(loaded));

const many = await import("./many.mjs");
let sum = 0;
for (const key of Object.keys(many))
  sum += many[key];
console.log(Object.keys(many).length, sum, many[join("name", "37")], many[join("name", "370")], many.name5, many[join("na", "me5")], many[join("name", "0x")]);

for (const key in direct)
  if (key.endsWith("Alone"))
    console.log(key);
const { secondAlone: taken = "absent", ...rest } = { ...direct };
console.log(typeof taken, Object.keys(rest).sort().join());
