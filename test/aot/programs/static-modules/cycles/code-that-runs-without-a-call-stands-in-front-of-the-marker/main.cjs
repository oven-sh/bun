// An accessor of a global and a conversion to a string run code in front of the statement that gives the module its `__esModule`, and no call is written there: whoever they run finds no marker.
Object.defineProperty(globalThis, "peek", {
  get() {
    const m = require("./read.cjs");
    console.log("early", m.__esModule, m.a);
    return 1;
  },
});
globalThis.text = {
  toString() {
    const m = require("./converted.cjs");
    console.log("early", m.__esModule, m.a);
    return "text";
  },
};
const first = require("./read.cjs");
console.log("late", first.__esModule, first.a);
const second = require("./converted.cjs");
console.log("late", second.__esModule, second.a);
