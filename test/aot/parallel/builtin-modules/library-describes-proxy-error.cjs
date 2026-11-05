// The text of ERR_INVALID_ARG_TYPE says what was received. Plain Bun asks a proxy around an array and calls it an instance of Array.
// An executable writes the description without running a trap: a handler without `get` has none to run, and the proxy is described by its target.
const vm = require("node:vm");
for (const value of [new Proxy([], {}), [], new Proxy(function named() {}, {}), 1, "text", Symbol("s"), null]) {
  try {
    vm.createContext({}, value);
    console.log("accepted");
  } catch (error) {
    console.log(error.code, error.message);
  }
}
