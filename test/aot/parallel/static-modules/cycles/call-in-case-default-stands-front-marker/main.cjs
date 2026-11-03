// The first call of a body stands in the test of a `case` or in the default of a pattern, in front of the statement that gives the module its `__esModule`: whoever it runs finds none.
globalThis.lookAtCase = () => {
  const m = require("./case.cjs");
  console.log("early", m.__esModule, m.a);
  return 1;
};
globalThis.lookAtDefault = () => {
  const m = require("./default.cjs");
  console.log("early", m.__esModule, m.a);
  return 2;
};
const first = require("./case.cjs");
console.log("late", first.__esModule, first.a);
const second = require("./default.cjs");
console.log("late", second.__esModule, second.a);
