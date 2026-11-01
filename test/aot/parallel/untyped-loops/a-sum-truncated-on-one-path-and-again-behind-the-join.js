function inOneArmThenBehindTheJoin(list, early) {
  let sum = 0;
  let bits = 0;
  for (let i = 0; i < list.length; i++) {
    const next = sum + list[i];
    if (early & (1 << (i & 7))) bits ^= next & 15;
    bits += next & 7;
    sum = next | 0;
  }
  return bits * 31 + sum;
}

function inBothArms(list) {
  let sum = 0;
  let bits = 0;
  for (let i = 0; i < list.length; i++) {
    const next = sum + list[i];
    if (i & 1) bits ^= next & 15;
    else bits += next & 3;
    sum = next | 0;
  }
  return bits * 31 + sum;
}

function theLongerSumFirst(list, early) {
  let sum = 0;
  let bits = 0;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const one = sum + list[i];
    const two = one + list[i + 1];
    if (early & (1 << (i & 7))) bits ^= two & 255;
    bits += one & 31;
    if (!(early & (2 << (i & 7)))) bits -= (two - one) & 63;
    sum = two | 0;
  }
  return bits * 31 + sum;
}

function inArmsWithinArms(list, early) {
  let sum = 0;
  let bits = 0;
  for (let i = 0; i < list.length; i++) {
    const next = sum + list[i];
    if (early & 1) {
      if (i & 1) bits ^= next & 15;
      if (i & 2) bits += next & 31;
    } else if (i & 4) {
      bits -= next & 63;
    }
    sum = (next + 1) | 0;
  }
  return bits * 31 + sum;
}

function lineAfterLine(list) {
  let sum = 0;
  let bits = 0;
  for (let turn = 0; turn < 3; turn++) {
    sum += list[0];
    bits ^= sum & 7;
    sum += list[1];
    bits ^= sum & 7;
    sum -= list[2];
    bits ^= sum & 7;
    sum += list[3];
    bits ^= sum & 7;
    sum += list[4];
    bits ^= sum & 7;
    sum = sum | 0;
  }
  return bits * 31 + sum;
}

const rows = [
  [1, 2, 3, 4, 5, 6, 7, 8],
  [1, -2.5, 3, 4.75, -5.25, 6, 7.5, 8],
  [2147483647, 1, -2147483648, -1, 2147483647, 2147483647, 5, 6],
  [2 ** 31, 2 ** 32, 2 ** 40 + 3, -(2 ** 33), 7, 2 ** 52 + 1, 2 ** 53 + 2, 9],
  [1, NaN, 3, 4, 5, 6, 7, 8],
  [1, 2, Infinity, 4, -Infinity, 6, 7, 8],
  [-0, -0, -0, -1, -0.5, 0.5, 1e300, -1e300],
];
for (const row of rows) {
  for (const list of [row, new Float64Array(row)]) {
    const answers = [inBothArms(list), lineAfterLine(list)];
    for (const early of [0, 1, 0x55, 0xaa, 0xff])
      answers.push(
        inOneArmThenBehindTheJoin(list, early),
        theLongerSumFirst(list, early),
        inArmsWithinArms(list, early),
      );
    console.log(answers.join(" "));
  }
}
