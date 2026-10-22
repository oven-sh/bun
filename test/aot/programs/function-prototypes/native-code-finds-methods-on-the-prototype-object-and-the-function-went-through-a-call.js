// Native code converts, serializes, spreads and awaits instances of plain functions, and finds toString, valueOf, toJSON, the iterator and `then` on their prototype objects. The build does not see under which name the function is constructed.
function hide(callable) { return callable; }
const seen = [];
const Text = hide(function Text() {}); Text.prototype.toString = function () { seen.push(this instanceof Text); return "text"; };
const Value = hide(function Value() {}); Value.prototype.valueOf = function () { seen.push(this instanceof Value); return 7; };
const Data = hide(function Data() {}); Data.prototype.toJSON = function (key) { seen.push(this instanceof Data, typeof key); return { data: 1 }; };
const List = hide(function List() {}); List.prototype[Symbol.iterator] = function* () { seen.push(this instanceof List); yield 1; yield 2; };
const Later = hide(function Later() {}); Later.prototype.then = function (resolve) { seen.push(this instanceof Later, typeof resolve); resolve("later"); };
const Shown = hide(function Shown() {}); Shown.prototype[Symbol.for("nodejs.util.inspect.custom")] = function () { seen.push(this instanceof Shown); return "shown"; };
console.log(String(new Text()), `${new Text()}`, new Value() + 1, JSON.stringify([new Data()]), [...new List()].join(), await new Later());
console.log(new Shown());
console.log(seen.join());
