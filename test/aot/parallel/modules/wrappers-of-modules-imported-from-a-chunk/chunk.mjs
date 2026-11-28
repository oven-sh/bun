import { c, e } from "./runtime.mjs";
import { early } from "./early.mjs";
var log = [early];
var require_leaf = c(function (exports) {
  log.push("leaf");
  exports.name = "leaf";
  exports.twice = value => value * 2;
});
var require_ping = c(function (exports) {
  exports.before = 1;
  exports.seen = require_pong().seen;
  exports.after = 2;
});
var require_pong = c(function (exports, module) {
  module.exports = { seen: JSON.stringify(require_ping()) };
});
var require_throws = c(function (exports) {
  log.push("throws");
  exports.partial = true;
  throw new RangeError("once");
});
var require_late = c(function (exports) {
  exports.value = require_leaf().twice(21);
});
var require_shared = c(function (exports) {
  log.push("shared");
  exports.leaf = require_leaf();
});
var counter;
var init_counter = e(() => {
  log.push("init");
  counter = require_leaf().twice(2);
});
var init_fails = e(() => {
  log.push("fails");
  throw new TypeError("again");
});
function viaDeclaration() {
  return require_late().value;
}
init_counter();
init_counter();
log.push(counter, require_ping().seen, require_ping().after);
for (let i = 0; i < 2; i++) {
  try {
    log.push(require_throws().partial);
  } catch (error) {
    log.push(error.message);
  }
  try {
    init_fails();
  } catch (error) {
    log.push(error.message);
  }
}
export { log, require_shared, viaDeclaration };
