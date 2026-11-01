// Number to text: compiled answers as plain.
console.log(
  [
    0.1 + 0.2,
    1e21,
    1e-7,
    123456789012345680000,
    -0,
    1 / 3,
    100,
    1.0,
    0.000001,
    1e300 * 10,
    (255).toString(16),
    (0.5).toString(2),
    (-255).toString(36),
    (1.005).toFixed(2),
    (1e21).toFixed(2),
    (0).toFixed(1),
    (1234.5678).toPrecision(6),
    (0.00001).toPrecision(1),
    (123).toExponential(1),
    5e-324,
    2 ** 53 + 2,
  ]
    .map(String)
    .join(" "),
);
