// RUN(ONCE): lower
// ONCE-COUNT-1: SetFunctionName
// ONCE-NOT: SetFunctionName

// RUN(MARKED): lower
// MARKED-COUNT-8: IsNamedByComputedKey
// MARKED-NOT: IsNamedByComputedKey

// RUN(NAMED): lower
// NAMED: function {{*}}name="text" {{*}}IsNamedByComputedKey
// NAMED: function {{*}}name="7" {{*}}IsNamedByComputedKey
// NAMED: function {{*}}name="NaN" {{*}}IsNamedByComputedKey
// NAMED: function {{*}}name="joined" {{*}}IsNamedByComputedKey
// NAMED: function {{*}}name="arrow" {{*}}IsNamedByComputedKey
// NAMED: function {{*}}name="own"
// NAMED: function {{*}}name="written"

// A function under a key in brackets has no name of its own: it gets the property `name` and nothing else, so the console prints `[Function]`.
// Where the value of the key is known when the program is compiled the text stands in the header, marked IsNamedByComputedKey, and nothing runs for it when the literal or the class is evaluated.
// The member of an enum is read when the program runs: the function under it is named then, once.
// A function that is written with a name keeps it, and so does one under a key that is written without brackets.
enum Color {
  Green = "green",
}

export const o = {
  ["text"]() {},
  [7]() {},
  [NaN]() {},
  ["join" + "ed"]() {},
  [Color.Green]() {},
  ["arrow"]: () => {},
  ["named"]: function own() {},
  written() {},
};

export class C {
  ["method"]() {}
  static ["method"]() {}
  ["field"] = () => {};
  written() {}
}
