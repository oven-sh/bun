// A sloppy store that the trap refuses returns, and files its pair. From then on the strict store of the same pair goes by the stub's road. It says what it said before.
// `bun <file>` and `bun build --compile` each take one of the two functions for the other kind, so what is expected stands below.
var mark = Symbol("mark");
var accesses = {
  getKey: function (o, k) { return o[k]; },
  hasKey: function (o, k) { return k in o; },
  setKeySloppy: function (o, k, v) { o[k] = v; return "stored"; },
  setKeyStrict: function (o, k, v) { "use strict"; o[k] = v; return "stored"; },
};
function run(name, o, k, v) {
  try { return String(accesses[name](o, k, v)); } catch (e) { return e.constructor.name + ": " + e.message; }
}
function refuses(target) { return new Proxy(target, { get() { return ""; }, has() { return ""; }, set() { return ""; } }); }
// Each text of the strict store, with the turn in which it is first said.
function tell(title, names, target, key, turns) {
  var said = [], last;
  for (var i = 0; i < turns; i++) for (var name of names) {
    var text = run(name, refuses(target()), key, 2);
    if (name === "setKeyStrict" && text !== last) { said.push(i + ": " + text); last = text; }
  }
  console.log(title + " | " + said.join(" | "));
}
var fn = function () { return function wanted(a, b) {}; }, empty = function () { return {}; };
tell("strict alone, a function", ["setKeyStrict"], fn, Symbol.iterator, 8);
tell("strict alone, an object", ["setKeyStrict"], empty, Symbol.iterator, 8);
tell("strict alone, a function, a symbol of the program", ["setKeyStrict"], fn, mark, 8);
tell("sloppy then strict, a function", ["setKeySloppy", "setKeyStrict"], fn, Symbol.asyncIterator, 8);
tell("sloppy then strict, an object", ["setKeySloppy", "setKeyStrict"], empty, Symbol.match, 8);
tell("sloppy then strict, a function, a symbol of the program", ["setKeySloppy", "setKeyStrict"], fn, Symbol("late"), 8);
tell("read then strict, a function", ["getKey", "setKeyStrict"], fn, Symbol.hasInstance, 8);
tell("asked then strict, a function", ["hasKey", "setKeyStrict"], fn, Symbol.toPrimitive, 8);
/* Output:
strict alone, a function | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'Symbol.iterator'
strict alone, an object | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'Symbol.iterator'
strict alone, a function, a symbol of the program | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'mark'
sloppy then strict, a function | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'Symbol.asyncIterator'
sloppy then strict, an object | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'Symbol.match'
sloppy then strict, a function, a symbol of the program | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'late'
read then strict, a function | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'Symbol.hasInstance'
asked then strict, a function | 0: TypeError: Proxy object's 'set' trap returned falsy value for property 'Symbol.toPrimitive'
*/
