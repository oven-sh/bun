// A run of property stores whose values are assignments to global variables and to names that do not exist.
import { runInThisContext as loadString } from "node:vm";
function check(actual, expected, what) {
  if (!Object.is(actual, expected)) throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
(function () {
  "use strict";
  function assignsToGlobal(o) {
    o.a = 1;
    o.b = 2;
    shadowedLater = ((o.c = 3), (o.d = 4), 5);
  }
  globalThis.shadowedLater = 0;
  assignsToGlobal({});
  check(globalThis.shadowedLater, 5, "the global property is assigned to");
  globalThis.shadowedLater = 0;
  assignsToGlobal({
    set a(x) {
      loadString("let shadowedLater = 'lexical';");
    },
  });
  check(
    globalThis.shadowedLater,
    0,
    "the setter of the first store declared a lexical binding, so the property is left alone",
  );
  check(loadString("shadowedLater"), 5, "and the binding is assigned to");

  function assignsToMissingGlobal(o) {
    o.a = 1;
    o.b = 2;
    definedLater = ((o.c = 3), (o.d = 4), 5);
  }
  let threw = false;
  try {
    assignsToMissingGlobal({});
  } catch (e) {
    threw = e instanceof ReferenceError;
  }
  check(threw, true, "an assignment to a name that does not exist");
  assignsToMissingGlobal({
    set b(x) {
      globalThis.definedLater = 0;
    },
  });
  check(globalThis.definedLater, 5, "the setter of the second store made the property");

  var outer = 0;
  function assignsToClosureVariable(o) {
    o.a = 1;
    o.b = 2;
    outer = ((o.c = 3), (o.d = 4), 5);
  }
  const log = [];
  assignsToClosureVariable({
    set a(x) {
      log.push("a:" + outer);
    },
    set d(x) {
      log.push("d:" + outer);
    },
  });
  check(log.join(), "a:0,d:0", "setters see the variable before the assignment");
  check(outer, 5, "the variable is assigned to");

  function storesOnly(o, v) {
    o.a = v;
    o.b = v;
    o.c = v;
    o.d = v;
  }
  storesOnly({}, 1);
})();
console.log("passed");
