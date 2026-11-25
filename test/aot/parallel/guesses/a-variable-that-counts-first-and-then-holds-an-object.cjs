// A variable counts up while an object of names is written and then holds that object, as a parser's table of states is written. What is read off the variable is whatever it holds at that time: a number's members while it counts, the object's afterwards; and the object is changed behind the compiler's back: a name written anew, taken away, made a getter, the object turned round.
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
  lib.fixed = fixed;
  var K = 0;
  tell("while it counts, nothing matches but undefined", () => lib.early([0, 1, undefined, 2]));
  tell("a number's own member while it counts", () => lib.fixed([1, 2]));
  lib.KINDS = { FIRST: K++, SECOND: K++, THIRD: K++ };
  tell("behind the counting", () => lib.early([0, 1, undefined, 2]) + " " + lib.fixed([1]));
  for (var name in lib.KINDS) lib.KINDS[lib.KINDS[name]] = name;
  K = lib.KINDS;
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
  function fixed(list) {
    var text = "";
    for (var i = 0; i < list.length; i++) text += typeof K.FIRST + typeof K.SECOND + ",";
    return text;
  }
})(exports);
const lib = module.exports;
const chosen = JSON.parse('["early","fixed"]');
const rows = [0, 1, 2, 2, 1, 7, undefined, "0"];
tell("the object", () => lib[chosen[0]](rows));
tell("the object, the kinds of its names", () => lib[chosen[1]]([1]));
tell("turned round", () => lib.KINDS[0] + lib.KINDS[2]);
lib.KINDS.SECOND = 7;
tell("a name is written anew", () => lib[chosen[0]](rows));
lib.KINDS.SECOND = "0";
tell("a name holds a text", () => lib[chosen[0]](rows) + " " + lib[chosen[1]]([1]));
delete lib.KINDS.THIRD;
tell("a name is taken away", () => lib[chosen[0]](rows));
Object.defineProperty(lib.KINDS, "FIRST", { get() { said.push("  the getter runs"); return 2; }, configurable: true });
tell("a name becomes a getter", () => lib[chosen[0]]([2, 0]));
Object.setPrototypeOf(lib.KINDS, { THIRD: 1 });
tell("a name comes from above", () => lib[chosen[0]]([1, 1]));
console.log(said.join("\n"));
