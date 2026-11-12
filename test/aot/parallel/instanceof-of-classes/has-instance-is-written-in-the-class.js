// The class on the right of `instanceof` declares a static method under Symbol.hasInstance, and so does the class above another one.
class Even { static [Symbol.hasInstance](x) { return typeof x === "number" && x % 2 === 0; } }
class Below extends Even { }
const key = Symbol.hasInstance;
class ByKey { static [key](x) { return x === "key"; } }
class ByField { static [key] = x => x === "field"; }
function isEven(x) { return x instanceof Even; }
function isBelow(x) { return x instanceof Below; }
function isByKey(x) { return x instanceof ByKey; }
function isByField(x) { return x instanceof ByField; }

function deed(x) {
  return [isEven(x), isBelow(x), isByKey(x), isByField(x)].join();
}
console.log(deed(2), deed(3), deed(new Even()), deed(new Below()), deed("key"), deed("field"), deed(new ByKey()), deed(new ByField()));
let said = "";
for (let i = 0; i < 200; i++) said = deed(i % 5 ? i : new Below());
console.log(said);
