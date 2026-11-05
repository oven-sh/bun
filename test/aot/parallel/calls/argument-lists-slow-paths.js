// Calls with an argument list or a spread on values nothing is known about: order of errors, array-likes, lists that change while they are read, and lists too long for the stack. One row differs from plain Bun: `apply` on what is no function throws before it reads the list, as the specification orders it. A list too long for the stack ends in a RangeError or, where the callee takes two parameters and the list need not be spread out, in the result: both count as survived.
function errorName(run) {
  try {
    return "returned " + String(run());
  } catch (error) {
    return error.constructor.name;
  }
}

function survives(run) {
  const outcome = errorName(run);
  return outcome === "RangeError" || outcome.startsWith("returned ") ? "survived" : outcome;
}

function loggingIterable(label, values) {
  return {
    [Symbol.iterator]() {
      console.log(label, "open");
      let index = 0;
      return {
        next() {
          console.log(label, "next", index);
          return index < values.length ? { value: values[index++], done: false } : { value: undefined, done: true };
        },
      };
    },
  };
}

function describeCall(...args) {
  return `${String(this)} [${args.map(String).join(", ")}] (${args.length})`;
}

const unknownValues = [undefined, 5, () => "arrow"];
const notCallable = unknownValues[0];
const arrow = unknownValues[2];

console.log("spread into undefined:", errorName(() => notCallable(...loggingIterable("call", [1, 2]))));
console.log("spread into method:", errorName(() => describeCall.call("t", ...loggingIterable("method", [1, 2]))));

console.log("apply array-like:", describeCall.apply("t", { length: 2, 0: 1 }));
console.log("apply undefined list:", describeCall.apply("t", undefined));
console.log("apply null list:", describeCall.apply("t", null));
console.log("apply number list:", errorName(() => describeCall.apply("t", 5)));
console.log("apply string list:", errorName(() => describeCall.apply("t", "ab")));
console.log("apply long list:", errorName(() => describeCall.apply("t", { length: 2 ** 21 })));

let lengthReads = 0;
const countedList = {
  get length() {
    lengthReads++;
    return 1;
  },
  0: "only",
};
console.log("apply counted length:", describeCall.apply("t", countedList), lengthReads);

const shrinking = [0, 1, 2];
Object.defineProperty(shrinking, 0, {
  get() {
    shrinking.length = 1;
    return "first";
  },
  configurable: true,
});
console.log("apply shrinking array:", describeCall.apply("t", shrinking), shrinking.length);

let listTouched = false;
const touchedList = {
  get length() {
    listTouched = true;
    return 0;
  },
};
console.log("apply on non-function:", errorName(() => Function.prototype.apply.call(notCallable, "t", touchedList)), listTouched);

console.log("new arrow spread:", errorName(() => new arrow(...loggingIterable("construct", [1]))));
console.log("new number spread:", errorName(() => new unknownValues[1](...loggingIterable("number", []))));
console.log("spread of number:", errorName(() => describeCall(...unknownValues[1])));

function Point(x, y) {
  this.sum = x + y;
}
console.log("new with spread:", new Point(...loggingIterable("point", [3, 4])).sum);

function repeatingIterable(count) {
  return {
    [Symbol.iterator]() {
      let index = 0;
      return {
        next() {
          return index++ < count ? { value: 0, done: false } : { value: undefined, done: true };
        },
      };
    },
  };
}
const unknownParents = [Point];
class LongListChild extends unknownParents[0] {
  constructor(list) {
    super(...list);
  }
}
console.log("call long iterable:", errorName(() => describeCall(...repeatingIterable(2 ** 21))));
console.log("new long iterable:", survives(() => new Point(...repeatingIterable(2 ** 21))));
console.log("super long array:", survives(() => new LongListChild(new Array(2 ** 21).fill(0))));
console.log("super short array:", new LongListChild([1, 2]).sum);

console.log("plain spread:", describeCall.call("t", ...[1, 2, 3]));
console.log("plain apply:", describeCall.apply("t", [1, 2, 3]));
console.log("plain new:", new Point(...[5, 6]).sum);
console.log("plain reflect construct:", Reflect.construct(Point, [7, 8]).sum);
/* Output:
call open
call next 0
call next 1
call next 2
spread into undefined: TypeError
method open
method next 0
method next 1
method next 2
spread into method: returned t [1, 2] (2)
apply array-like: t [1, undefined] (2)
apply undefined list: t [] (0)
apply null list: t [] (0)
apply number list: TypeError
apply string list: TypeError
apply long list: RangeError
apply counted length: t [only] (1) 1
apply shrinking array: t [first, undefined, undefined] (3) 1
apply on non-function: TypeError false
construct open
construct next 0
construct next 1
new arrow spread: TypeError
number open
number next 0
new number spread: TypeError
spread of number: TypeError
point open
point next 0
point next 1
point next 2
new with spread: 7
call long iterable: RangeError
new long iterable: survived
super long array: survived
super short array: 3
plain spread: t [1, 2, 3] (3)
plain apply: t [1, 2, 3] (3)
plain new: 11
plain reflect construct: 15
*/
