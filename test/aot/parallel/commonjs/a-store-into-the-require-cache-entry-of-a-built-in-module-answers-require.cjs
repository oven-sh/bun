function load() {
  return require("bun:jsc");
}

const real = load();
console.log("before:", load() === real, typeof load().heapSize);
const entry = require.cache["bun:jsc"];
console.log("entry read:", load() === real, entry.exports === real);
entry.exports = { fake: "stored" };
console.log("stored:", load() === real, load().fake, require("bun:jsc").fake, typeof load().heapSize);
entry.exports = real;
console.log("stored back:", load() === real, typeof load().heapSize);
delete require.cache["bun:jsc"];
entry.exports = { fake: "stale" };
console.log("deleted:", load() === real, require.cache["bun:jsc"] === entry, require.cache["bun:jsc"].exports === real);
