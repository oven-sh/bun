var read =
  globalThis.noSuchThing ||
  function (holder, key) {
    return holder[key];
  };
var holder = require("./counted");
for (var key in holder) {
  console.log(typeof read(holder, key));
  console.log(typeof read(holder, key));
  console.log(read(holder, key));
}
