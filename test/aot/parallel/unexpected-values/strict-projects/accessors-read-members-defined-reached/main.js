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
/* Output:
0 counted number 2 true
0 kept number 0 true
0 fixed number 7 true
0 hidden number 8 true
0 plain number 9 true
1 counted number 4 true
1 kept number 0 true
1 fixed number 7 true
1 hidden number 8 true
1 plain number 9 true
2 counted number 6 true
2 kept number 0 true
2 fixed number 7 true
2 hidden number 8 true
2 plain number 9 true
3 counted number 8 true
3 kept number 0 true
3 fixed number 7 true
3 hidden number 8 true
3 plain number 9 true
0 counted TypeError 9
0 kept no 2
0 fixed TypeError 7
0 hidden no 200
0 plain no 200
1 counted TypeError 10
1 kept no 4
1 fixed TypeError 7
1 hidden no 201
1 plain no 201
2 counted TypeError 11
2 kept no 6
2 fixed TypeError 7
2 hidden no 202
2 plain no 202
3 counted TypeError 12
3 kept no 8
3 fixed TypeError 7
3 hidden no 203
3 plain no 203
100,200,101,201,102,202,103,203
for in counted number
for in kept number
for in fixed number
for in plain number
for in stored object
counted,kept,fixed,plain,stored number number
number number 7 undefined 203
number number 7 undefined 203
{"counted":N,"kept":N,"fixed":N,"plain":N,"stored":[N,N,N,N,N,N,N,N]}
function undefined true false false
number number fixed,plain,stored
*/
