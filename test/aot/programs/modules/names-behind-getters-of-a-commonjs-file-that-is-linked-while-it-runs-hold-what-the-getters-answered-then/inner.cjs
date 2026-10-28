const index = require("./index.cjs");
function attempt(read) {
  try {
    return typeof read();
  } catch (error) {
    return error.constructor.name;
  }
}
globalThis.readRequired = function () {
  return [() => index.early, () => index.fixed, () => index.loose, () => index.hoisted, () => index.made].map(attempt).join();
};
console.log("required", readRequired());
const handedOn = require("./hands-on.mjs");
console.log("handed on", Object.keys(handedOn).join());
console.log(
  "handed on",
  [() => handedOn.early, () => handedOn.fixed, () => handedOn.loose, () => handedOn.hoisted, () => handedOn.made].map(attempt).join(),
);
