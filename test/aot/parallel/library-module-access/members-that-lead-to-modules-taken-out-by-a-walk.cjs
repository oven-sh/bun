// What stands under the names of process, require, module and node:module that lead to modules, taken out in every way that does not write the name.
// Alone: what another program of the executable names decides what this one finds.
const host = require("node:module");

const starts = ["mai", "cac", "_cac", "requ", "wra", "_loa", "_resolveF"];
const turned = ["eludoMniam", "niam", "ehcac", "ehcac_", "eriuqer", "parw", "daol_", "emaneliFevloser_"];

const ways = {
  "for-in"(holder) {
    const found = [];
    for (const key in holder) found.push([key, holder[key]]);
    return found;
  },
  "Object.keys": holder => Object.keys(holder).map(key => [key, holder[key]]),
  "Object.getOwnPropertyNames": holder => Object.getOwnPropertyNames(holder).map(key => [key, holder[key]]),
  "Reflect.ownKeys": holder => Reflect.ownKeys(holder).map(key => [key, holder[key]]),
  "Reflect.get": holder => Object.keys(holder).map(key => [key, Reflect.get(holder, key)]),
  "Object.entries": holder => Object.entries(holder),
  "Object.values"(holder) {
    const keys = Object.keys(holder);
    return Object.values(holder).map((value, index) => [keys[index], value]);
  },
  "Object.getOwnPropertyDescriptors": holder =>
    Object.entries(Object.getOwnPropertyDescriptors(holder)).map(([key, descriptor]) => [
      key,
      "value" in descriptor ? descriptor.value : descriptor.get?.call(holder),
    ]),
  "a spread": holder => Object.entries({ ...holder }),
  "Object.assign": holder => Object.entries(Object.assign({}, holder)),
  "a rest element"(holder) {
    const { nothingOfThatName, ...rest } = holder;
    return Object.entries(rest);
  },
  "JSON.stringify"(holder) {
    const found = [];
    JSON.stringify(holder, function (key, value) {
      if (key === "") return value;
      if (this === holder) found.push([key, value]);
    });
    return found;
  },
  structuredClone(holder) {
    try {
      return Object.entries(structuredClone(holder));
    } catch (error) {
      return [["mai", error.name]];
    }
  },
  "a key out of a variable": holder =>
    turned.map(text => text.split("").reverse().join("")).map(key => [key, holder[key]]),
};

function kindOf(value) {
  if (typeof value === "string") return value;
  return typeof value + (value !== null && typeof value === "object" && typeof value.id === "string" ? " " + value.id : "");
}

const holders = {
  process,
  require,
  "a made require": host.createRequire(__filename),
  module,
  "node:module": host,
  "node:module.prototype": host.prototype,
};

for (const [title, holder] of Object.entries(holders)) {
  for (const [way, walk] of Object.entries(ways)) {
    const wanted = walk(holder).filter(([key]) => typeof key === "string" && starts.some(start => key.startsWith(start)));
    const kinds = wanted.map(([key, value]) => key + ":" + kindOf(value)).sort();
    console.log(title, "|", way, "|", kinds.join(" "));
  }
}
