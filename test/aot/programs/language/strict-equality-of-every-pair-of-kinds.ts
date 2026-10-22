function countEqual(left: unknown[], right: unknown[], rounds: number): string {
  let rows = "";
  for (let round = 0; round < rounds; round++) {
    rows = "";
    for (let i = 0; i < left.length; i++) {
      let row = "";
      for (let j = 0; j < right.length; j++) row += left[i] === right[j] ? "1" : "0";
      rows += row + "\n";
    }
  }
  return rows;
}

function values(suffix: string): unknown[] {
  const symbol = Symbol.for("shared");
  return [
    undefined,
    null,
    true,
    false,
    0,
    -0,
    1,
    Number("1"),
    Number("1.0") * 1.0,
    1.5,
    3 / 2,
    NaN,
    2 ** 31,
    2147483648.0,
    -(2 ** 31),
    Infinity,
    "",
    "a",
    "a" + suffix,
    ("a" + suffix + "b").slice(0, 1),
    "long text that is built at run time " + suffix,
    symbol,
    Symbol("own"),
    1n,
    BigInt("1"),
    2n ** 70n,
    BigInt("1180591620717411303424"),
    shared,
    {},
    [],
    countEqual,
  ];
}

const shared = { id: 1 };
const halves: unknown[] = [0.5 + 0.5, 4 / 4, Math.sqrt(1), Math.abs(-0), -Math.abs(0), Math.round(-0.2)];
console.log(countEqual(values(""), values(""), 300));
console.log(countEqual(halves, values(""), 300));
console.log(countEqual(values(""), halves, 300));
