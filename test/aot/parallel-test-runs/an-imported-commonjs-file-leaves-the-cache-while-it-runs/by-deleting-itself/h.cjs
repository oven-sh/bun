globalThis.h = (globalThis.h ?? 0) + 1;
console.log("h");
if (globalThis.h === 1) {
  delete require.cache[__filename];
}
module.exports = { v: "h" + globalThis.h };
