var read =
  globalThis.noSuchThing ||
  function (holder, key) {
    return holder[key];
  };
var write =
  globalThis.noSuchThing ||
  function (holder, key, value) {
    holder[key] = value;
  };
var writeStrictly =
  globalThis.noSuchThing ||
  function (holder, key, value) {
    "use strict";
    holder[key] = value;
  };
var has =
  globalThis.noSuchThing ||
  function (holder, key) {
    return key in holder;
  };
var holder = require("./defined");
var names = ["counted", "kept", "fixed", "hidden", "plain"];
for (var round = 0; round < 4; round++) {
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    console.log(round, name, typeof read(holder, name), read(holder, name), has(holder, name));
  }
}
for (var round = 0; round < 4; round++) {
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    write(holder, name, 100 + round);
    var thrown = "no";
    try {
      writeStrictly(holder, name, 200 + round);
    } catch (error) {
      thrown = error instanceof TypeError ? "TypeError" : "other";
    }
    console.log(round, name, thrown, read(holder, name));
  }
}
console.log(holder.stored.join());
for (var key in holder) console.log("for in", key, typeof read(holder, key));
console.log(Object.keys(holder).join(), typeof Object.values(holder)[0], typeof Object.entries(holder)[1][1]);
var copy = Object.assign({}, holder);
console.log(typeof copy.counted, typeof copy.kept, copy.fixed, copy.hidden, copy.plain);
var spread = { ...holder };
console.log(typeof spread.counted, typeof spread.kept, spread.fixed, spread.hidden, spread.plain);
console.log(JSON.stringify(holder).replace(/[0-9]+/g, "N"));
var descriptor = Object.getOwnPropertyDescriptor(holder, "counted");
console.log(typeof descriptor.get, descriptor.set, descriptor.enumerable, descriptor.configurable, "value" in descriptor);
var { counted, kept, ...rest } = holder;
console.log(typeof counted, typeof kept, Object.keys(rest).join());
