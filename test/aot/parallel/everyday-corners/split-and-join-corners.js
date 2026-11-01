// Split and join corners: compiled answers as plain.
console.log(
  JSON.stringify([
    "a,b,".split(","),
    "".split(","),
    "".split(""),
    "abc".split(""),
    "a1b2".split(/\d/),
    "a1b2".split(/(\d)/),
    "abc".split("", 2),
    "abc".split(undefined),
    [null, undefined, 1, [2, [3]]].join("-"),
    [].join(),
    [undefined].join(),
    [[]].join(),
  ]),
);
