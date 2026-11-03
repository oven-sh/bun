var log = [];
exports.log = log;
exports.makers = {
  text: function () { return "abc"; },
  boxed: function () { return new String("abc"); },
  list: function () { return ["a", "b", "c"]; },
  bytes: function () { return Buffer.from("abc"); },
  like: function () {
    return {
      length: 3,
      0: "a",
      charCodeAt: function () { return "own charCodeAt"; },
      slice: function () { return "own slice"; },
      indexOf: function () { return "own indexOf"; },
      toUpperCase: function () { return "own toUpperCase"; },
      split: function () { return "own split"; },
      toString: function () { log.push("toString"); return "abc"; },
    };
  },
  number: function () { return 123; },
  none: function () { return null; },
  nothing: function () { return undefined; },
  symbol: function () { return Symbol("abc"); },
  rope: function () { return "a".concat("b") + ["c"][0]; },
  wide: function () { return "aб😀"; },
  halfOfAPair: function () { return "ab\ud83d"; },
  heir: function () { return Object.create(new String("abc")); },
  aFunction: function () { return Object.assign(function abc(a, b, c) {}, { toString: function () { return "abc"; } }); },
  date: function () { return new Date(0); },
  expression: function () { return /abc/; },
};
