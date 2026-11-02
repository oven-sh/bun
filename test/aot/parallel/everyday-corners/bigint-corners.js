// Bigint corners: compiled answers as plain.
const t = g => {
  try {
    return String(g());
  } catch (e) {
    return e.constructor.name;
  }
};
console.log(
  t(() => 1n + 2n),
  t(() => 1n + 1),
  t(() => 2n ** 64n),
  t(() => -7n / 2n),
  t(() => -7n % 2n),
  t(() => 1n < 2),
  t(() => 1n == 1),
  t(() => 1n === 1),
  t(() => BigInt(1.5)),
  t(() => BigInt("0x10")),
  t(() => typeof 1n),
  t(() => +1n),
  t(() => Number(2n ** 64n)),
  t(() => BigInt.asUintN(8, -1n)),
  t(() => (1n ? "y" : "n")),
  t(() => (0n ? "y" : "n")),
  t(() => JSON.stringify(1n)),
  t(() => [3n, 1, 2n].sort().join()),
  t(() => 5n >> 1n),
  t(() => 1n / 0n),
);
