// The same variable, and a function of the same file stores other values into it, all written in sight: another object with the names, one with other names, one with names from above, a number again, a text, null, undefined; and once in the middle of the loop that reads it.
"use strict";
const said = [];
function tell(what, make) {
  try {
    said.push(what + ": " + String(make()));
  } catch (error) {
    said.push(what + ": " + error.constructor.name);
  }
}
(function (lib) {
  lib.early = early;
  lib.swap = swap;
  var K = 0;
  var turns = 0;
  lib.KINDS = { FIRST: K++, SECOND: K++, THIRD: K++ };
  K = lib.KINDS;
  function swap(which) {
    switch (which) {
      case 0: K = { FIRST: 1, SECOND: 2, THIRD: 0 }; break;
      case 1: K = { other: 1 }; break;
      case 2: K = 5; break;
      case 3: K = "FIRST"; break;
      case 4: K = null; break;
      case 5: K = undefined; break;
      case 6: K = { __proto__: { FIRST: 0, SECOND: 1 }, THIRD: 2 }; break;
      case 7: K = { FIRST: 0, get SECOND() { if (++turns === 2) swap(8); return 1; }, THIRD: 2 }; break;
      case 8: K = { THIRD: 1, SECOND: 0, FIRST: 2 }; break;
    }
  }
  function early(list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      switch (list[i]) {
        case K.FIRST: n += 1; break;
        case K.SECOND: n += 10; break;
        case K.THIRD: n += 100; break;
      }
    }
    return n;
  }
})(exports);
const lib = module.exports;
const chosen = JSON.parse('["early","swap"]');
const rows = [0, 1, 2, 2, 1, 7, undefined, "0"];
tell("the object", () => lib[chosen[0]](rows));
const kinds = ["another object", "an object with other names", "a number again", "a text", "null", "undefined", "names from above"];
for (let which = 0; which < kinds.length; which++) {
  lib[chosen[1]](which);
  tell(kinds[which], () => lib[chosen[0]](rows));
  tell(kinds[which] + ", no turn", () => lib[chosen[0]]([]));
}
lib[chosen[1]](7);
tell("the variable is written in the middle of the loop", () => lib[chosen[0]]([1, 1, 2, 0, 1]));
console.log(said.join("\n"));
