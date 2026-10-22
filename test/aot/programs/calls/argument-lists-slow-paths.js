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
