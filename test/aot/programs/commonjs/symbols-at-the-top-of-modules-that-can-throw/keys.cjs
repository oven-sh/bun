const helper = require("./helper.cjs");
const kState = Symbol("state");
const kBare = Symbol();
class Box {
  constructor() {
    this[kState] = helper.start();
    this[kBare] = "bare";
  }
  get state() { return this[kState]; }
}
function stateOf(box) { return box[kState]; }
helper.check(new Box().state);
module.exports = { Box, kState, kBare, stateOf };
