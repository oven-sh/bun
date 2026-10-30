// f.call(..), f.apply(..) and Reflect.apply(f, ..) where f comes out of text made at run time: receivers, few and many arguments, lists of every kind, own members named call, and what cannot be called.
const pad = process.argv.length > 99 ? " " : "";
const hide = new Function("value", "return value" + pad);

function add(first, second) {
  return this.base + first + second;
}
function count() {
  return arguments.length + ":" + Array.prototype.join.call(arguments, "|");
}
function rest(first, ...others) {
  return first + "/" + others.join("|") + "@" + this.base;
}
function strictReceiver() {
  "use strict";
  return typeof this + ":" + String(this);
}
function passOn() {
  return table.count.apply(this, arguments);
}
function passOnToRest() {
  return table.rest.apply(this, arguments);
}
const sloppyReceiver = new Function("return typeof this + ':' + (this === globalThis ? 'global' : String(this))" + pad);
const arrow = (first, second) => first * second;
class Counter {
  constructor(base) {
    this.base = base;
  }
  next(step) {
    return this.base + step;
  }
  static make() {
    return new this(3);
  }
}
async function later(step) {
  return this.base + step;
}
function* walk(length) {
  for (let i = 0; i < length; i++) yield this.base + i;
}
function thrower(limit) {
  if (limit > 2) throw new RangeError("too large: " + limit + " with " + this.base);
  return limit;
}

const table = hide({
  add,
  count,
  rest,
  strictReceiver,
  sloppyReceiver,
  arrow,
  later,
  walk,
  thrower,
  passOn,
  passOnToRest,
  Counter,
  bound: add.bind({ base: 100 }, 1),
  native: Array.prototype.slice,
  ownCall: Object.assign(
    function () {
      return "body";
    },
    {
      call() {
        return "own call:" + arguments.length;
      },
      apply() {
        return "own apply:" + arguments.length;
      },
    },
  ),
  inheritsFunctionPrototype: Object.create(Function.prototype),
  proxy: new Proxy(add, {
    apply(target, receiver, list) {
      return "trap:" + receiver.base + ":" + list.join();
    },
  }),
});
const receiver = { base: 10 };

let sum = 0;
for (let i = 0; i < 1000; i++) sum = (sum + table.add.call(receiver, i, 1)) | 0;
for (let i = 0; i < 1000; i++) sum = (sum + table.add.apply(receiver, [i, 2])) | 0;
for (let i = 0; i < 1000; i++) sum = (sum + Reflect.apply(table.add, receiver, [i, 3])) | 0;
console.log(sum);

console.log(
  table.count.call(),
  table.count.call(receiver),
  table.count.call(receiver, 1),
  table.count.call(receiver, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
);
console.log(table.rest.call(receiver), table.rest.call(receiver, 1), table.rest.call(receiver, 1, 2, 3, 4, 5, 6, 7, 8));
console.log(
  table.strictReceiver.call(),
  table.strictReceiver.call(null),
  table.strictReceiver.call(5),
  table.strictReceiver.call("s"),
  table.strictReceiver.call(receiver),
);
console.log(
  table.sloppyReceiver.call(),
  table.sloppyReceiver.call(null),
  table.sloppyReceiver.call(5),
  table.sloppyReceiver.call("s"),
);
console.log(
  table.arrow.call(receiver, 6, 7),
  table.bound.call(receiver, 2),
  table.native.call([1, 2, 3, 4], 1, 3).join(),
  table.proxy.call(receiver, 1, 2),
);
console.log(
  table.Counter.prototype.next.call(receiver, 5),
  table.Counter.make.call(table.Counter).next(1),
  [...table.walk.call(receiver, 3)].join(),
);
console.log(
  table.ownCall.call(receiver, 1, 2),
  table.ownCall.apply(receiver, [1]),
  Function.prototype.call.call(table.ownCall, receiver),
);

console.log(
  table.count.apply(),
  table.count.apply(receiver),
  table.count.apply(receiver, undefined),
  table.count.apply(receiver, null),
  table.count.apply(receiver, []),
);
console.log(
  table.count.apply(receiver, [1, , 3]),
  table.count.apply(receiver, { length: 2, 0: "a", 1: "b" }),
  table.count.apply(receiver, new Uint8Array([7, 8])),
  table.count.apply(receiver, "no list".split(" ")),
);
console.log(
  table.passOn(),
  table.passOn(1),
  table.passOn(1, 2, 3, 4, 5, 6, 7, 8, 9),
  table.passOnToRest.call(receiver, 1, 2, 3),
);
console.log(
  table.count.apply(receiver, hide([1, 2])),
  table.count.apply(receiver, hide({ length: 1, 0: "x" })),
  Reflect.apply(table.count, receiver, hide([4, 5, 6])),
);

const order = [];
const seen = table.count.call((order.push("receiver"), receiver), (order.push("first"), 1), (order.push("second"), 2));
console.log(seen, order.join());

function nameOf(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(
  nameOf(() => table.inheritsFunctionPrototype.call(receiver)),
  nameOf(() => table.inheritsFunctionPrototype.apply(receiver, [])),
  nameOf(() => Reflect.apply(table.inheritsFunctionPrototype, receiver, [])),
);
console.log(
  nameOf(() => table.missing.call(receiver)),
  nameOf(() => hide(5).call(receiver)),
  nameOf(() => hide({}).apply(receiver)),
  nameOf(() => table.Counter.call(receiver, 1)),
);
console.log(
  nameOf(() => table.count.apply(receiver, 5)),
  nameOf(() => table.count.apply(receiver, hide("text"))),
  nameOf(() => Reflect.apply(table.count, receiver)),
  nameOf(() => table.thrower.call(receiver, 3)),
  table.thrower.call(receiver, 1),
);
try {
  table.thrower.apply(receiver, [9]);
} catch (error) {
  console.log(error.message);
}
table.later.call(receiver, 4).then(value => console.log("later", value));
