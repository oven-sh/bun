// Names of globals declared anew in seven kinds of scope.
var Array = function () { return "own Array"; };
function f(Object) { return Object.keys({ a: 1 }); }
console.log(Array(), f({ keys: () => "own keys" }));
{ let Math = { max: () => "own max" }; console.log(Math.max(1, 2)); }
(function () { var JSON; console.log(typeof JSON); JSON = { parse: () => "own parse" }; console.log(JSON.parse("1")); })();
try { undefinedThing; } catch (Error) { console.log(typeof Error, Error instanceof ReferenceError); }
class Map { get size() { return "own size"; } }
console.log(new Map().size, new globalThis.Map().size);
