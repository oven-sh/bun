// Evaluates BigInt literals for the first time while the heap is full.
// Plain Bun has no heap limit, so each loop also stops at a fixed count.
const most = 1_500_000;

function fill(lists, make) {
  for (let made = 0; made < most; made += 1024) {
    const items = [];
    lists.push(items);
    for (let at = 0; at < 1024; at++) items.push(make(at));
  }
}

function powers() {
  return [
    18446744073709551616n,
    340282366920938463463374607431768211456n,
    115792089237316195423570985008687907853269984665640564039457584007913129639936n,
  ];
}

function say() {
  console.log(
    [
      1n,
      64n,
      ...powers(),
      2n,
      36893488147419103232n,
      0x1_0000_0000_0000_0000_0000n,
      0b1_00000000_00000000_00000000_00000000_00000000_00000000_00000000_00000000n,
    ].join(" "),
  );
  isSaid = true;
}

let isSaid = false;
let held = [];
const steps = [
  () => fill([], at => BigInt(at) + 1n),
  () => fill([], at => BigInt(at) << 64n),
  () => fill([], at => powers()[at % 3] + BigInt(at)),
  () => fill(held, at => BigInt(at) + 2n),
  () => fill(held, at => BigInt(at) + 36893488147419103232n),
  () => fill(held, at => BigInt(at) * 0x1_0000_0000_0000_0000_0000n),
  () => fill(held, at => BigInt(at) - 0b1_00000000_00000000_00000000_00000000_00000000_00000000_00000000_00000000n),
  () => (held = null),
  say,
  say,
  say,
  say,
];
for (let step = 0; step < steps.length && !isSaid; step++) {
  try {
    steps[step]();
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
}
