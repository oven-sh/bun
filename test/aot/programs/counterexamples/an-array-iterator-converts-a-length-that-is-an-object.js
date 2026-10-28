// An array iterator converts the length of the object that it goes over to a number. Nothing else in the program converts these lengths.
const byValueOf = {
  length: {
    valueOf() {
      return 2;
    },
  },
  0: 1,
  1: 2,
};
const byToString = {
  length: {
    toString() {
      return "2";
    },
  },
  0: 3,
  1: 4,
};
const byToPrimitive = {
  length: {
    [Symbol.toPrimitive](hint) {
      return hint === "number" ? 2 : 0;
    },
  },
  0: 5,
  1: 6,
};
const behindAGetter = {
  get length() {
    return {
      valueOf() {
        return 1;
      },
    };
  },
  0: 7,
};
const thrower = {
  length: {
    valueOf() {
      throw new RangeError("no length");
    },
  },
};
console.log(JSON.stringify([...Array.prototype.values.call(byValueOf)]));
console.log(JSON.stringify([...Array.prototype.entries.call(byToString)]));
console.log(JSON.stringify([...Array.prototype.keys.call(byToPrimitive)]));
console.log(JSON.stringify(Array.from(Array.prototype.values.call(behindAGetter))));
try {
  console.log(Array.prototype.values.call(thrower).next());
} catch (thrown) {
  console.log(thrown.name, thrown.message);
}
