// Functions of code that is not strict ask `this instanceof` themselves and construct themselves otherwise. Each is called
// plainly before and after something makes the global object pass that test, and then stores, reads or deletes through `this`.
function key(name) {
  return process.argv.length > 50 ? "other" : name;
}
function look(label, name, answer) {
  console.log(
    label,
    answer === undefined ? "nothing" : JSON.stringify(answer),
    typeof globalThis[name],
    globalThis[name],
    Object.keys(globalThis).includes(name),
  );
  delete globalThis[name];
}

function Replaced(v) {
  if (!(this instanceof Replaced)) return new Replaced(v);
  this.replaced = v;
}
look("prototype as made", "replaced", Replaced(1));
Replaced.prototype = Object.prototype;
look("prototype replaced", "replaced", Replaced(2));
look("prototype replaced, new", "replaced", new Replaced(3));

function FromTable(v) {
  if (!(this instanceof FromTable)) return new FromTable(v);
  this.fromTable = v;
}
look("table before", "fromTable", FromTable(1));
var table = [FromTable.prototype, Object.getPrototypeOf({})];
FromTable.prototype = table[process.argv.length > 50 ? 0 : 1];
FromTable(5);
console.log(typeof fromTable, globalThis.fromTable, Object.keys(globalThis).includes("fromTable"));
function readFreeName() {
  return fromTable + 1;
}
console.log(readFreeName());
delete globalThis.fromTable;

function ByKey(v) {
  if (!(this instanceof ByKey)) return new ByKey(v);
  this.byKey = v;
}
look("key before", "byKey", ByKey(1));
ByKey[key("prototype")] = Object.prototype;
look("key after", "byKey", ByKey(2));

function Defined(v) {
  if (!(this instanceof Defined)) return new Defined(v);
  this.defined = v;
}
look("define before", "defined", Defined(1));
Object.defineProperty(Defined, "prototype", { value: Object.prototype });
look("define after", "defined", Defined(2));

function Above(v) {
  if (!(this instanceof Above)) return new Above(v);
  this.above = v;
}
look("chain before", "above", Above(1));
Object.setPrototypeOf(globalThis, Above.prototype);
look("chain after", "above", Above(2));
Object.setPrototypeOf(globalThis, Object.prototype);
look("chain back", "above", Above(3));

function Asked(v) {
  if (!(this instanceof Asked)) return new Asked(v);
  this.asked = v;
}
look("method before", "asked", Asked(1));
Object.defineProperty(Asked, Symbol.hasInstance, {
  value() {
    return true;
  },
});
look("method after", "asked", Asked(2));
look("method after, null", "asked", Asked.call(null, 3));
look("method after, bound", "asked", Asked.bind(undefined)(4));
look("method after, applied", "asked", Reflect.apply(Asked, undefined, [5]));
look("method after, callback", "asked", [6].map(Asked)[0]);

function Inherits(v) {
  if (!(this instanceof Inherits)) return new Inherits(v);
  this.inherits = v;
}
look("inherited method before", "inherits", Inherits(1));
Object.setPrototypeOf(Inherits, {
  [Symbol.hasInstance]() {
    return true;
  },
});
look("inherited method after", "inherits", Inherits(2));

function Positive(v) {
  if (this instanceof Positive) {
    this.positive = v;
    this.second = String(v);
  } else return new Positive(v);
}
look("other order before", "positive", Positive(1));
Positive.prototype = Object.prototype;
look("other order after", "positive", Positive(2));
look("other order after", "second", undefined);

function Computed(v) {
  if (!(this instanceof Computed)) return new Computed(v);
  this[key("computed")] = v;
}
look("computed before", "computed", Computed(1));
Computed.prototype = Object.prototype;
look("computed after", "computed", Computed(2));

function Captured(v) {
  if (!(this instanceof Captured)) return new Captured(v);
  var self = this;
  (function () {
    self.captured = v;
  })();
}
look("closure before", "captured", Captured(1));
Captured.prototype = Object.prototype;
look("closure after", "captured", Captured(2));

var seen = [];
function Reads(v) {
  if (!(this instanceof Reads)) return new Reads(v);
  seen.push(typeof this.held, typeof this.Object, this === globalThis);
}
globalThis.held = "held";
Reads(1);
Reads.prototype = Object.prototype;
Reads(2);
console.log(seen.join());

function Deletes(v) {
  if (!(this instanceof Deletes)) return new Deletes(v);
  seen.push(delete this.held);
}
seen.length = 0;
Deletes(1);
console.log(seen.join(), typeof held);
Deletes.prototype = Object.prototype;
Deletes(2);
console.log(seen.join(), typeof held);

function Returns(v) {
  if (!(this instanceof Returns)) return new Returns(v);
  this.returned = v;
  return this;
}
console.log(Returns(1) === globalThis, Returns(1).returned);
Returns.prototype = Object.prototype;
console.log(Returns(2) === globalThis, Returns(2).returned, returned);
delete globalThis.returned;
