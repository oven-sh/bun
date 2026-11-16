const log = [];
exports.log = log;
exports.values = {
  three: () => 3,
  text: () => "3",
  emptyText: () => "",
  wordText: () => "three",
  valueOf: () => ({
    valueOf() {
      log.push("valueOf");
      return 3;
    },
  }),
  toStringOnly: () => ({
    toString() {
      log.push("toString");
      return "3";
    },
  }),
  both: () => ({
    valueOf() {
      log.push("valueOf");
      return {};
    },
    toString() {
      log.push("toString");
      return "3";
    },
  }),
  toPrimitive: () => ({
    [Symbol.toPrimitive](hint) {
      log.push("toPrimitive " + hint);
      return hint === "string" ? "three" : 3;
    },
  }),
  throwing: () => ({
    valueOf() {
      log.push("valueOf throws");
      throw new RangeError("no value");
    },
  }),
  big: () => 3n,
  nothing: () => null,
  missing: () => undefined,
  yes: () => true,
  date: () => new Date(3),
  notANumber: () => NaN,
  minusZero: () => -0,
  boxed: () => new Number(3),
  listOfOne: () => [3],
  emptyList: () => [],
  symbol: () => Symbol("3"),
  fraction: () => 3.5,
  large: () => 2147483647,
};
