// Text to number: compiled answers as plain.
console.log(
  [
    "",
    " ",
    "1",
    " 1 ",
    "1a",
    "0x10",
    "0b11",
    "0o7",
    "1e3",
    ".5",
    "5.",
    "-",
    "+1",
    "-0",
    "Infinity",
    "infinity",
    "1_000",
    "١",
    "\n2\t",
    null,
    undefined,
    true,
    [],
    [1],
    [1, 2],
    {},
  ]
    .map(v => {
      const n = Number(v);
      return Object.is(n, -0) ? "-0" : String(n);
    })
    .join(),
  parseInt("08"),
  parseInt("0x1f"),
  parseInt("12px"),
  parseInt(""),
  parseInt("z", 36),
  parseInt("10", 1),
  parseInt(0.0000005),
  parseFloat("1.5e2x"),
  parseFloat(".5."),
);
