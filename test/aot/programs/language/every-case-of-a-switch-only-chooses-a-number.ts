function small(k: number): number {
  switch (k) {
    case 0: return 3;
    case 1: return 1;
    case 2: return 4;
    case 3: return 1;
    case 4: return 5;
    case 5: return 9;
    case 6: return 2;
    case 7: return 6;
    default: return 250;
  }
}
function wide(k: number): number {
  switch (k) {
    case 10: return 300;
    case 11: return 65535;
    case 12: return 256;
    case 13: return 0;
    case 14: return 4096;
    case 15: return 77;
    case 17: return 12345;
    case 18: return 1;
    default: return 65000;
  }
}
function signed(k: number): number {
  switch (k) {
    case -3: return -1;
    case -2: return 2147483647;
    case -1: return -2147483648;
    case 0: return 70000;
    case 1: return -70000;
    case 2: return 0;
    case 3: return 255;
    case 4: return -256;
    default: return -7;
  }
}
function masked(k: number, r: number): number {
  switch (k & 7) {
    case 0: r ^= 1; break;
    case 1: r ^= 2; break;
    case 2: r ^= 5; break;
    case 3: r ^= 10; break;
    case 4: r ^= 17; break;
    case 5: r ^= 26; break;
    case 6: r ^= 37; break;
    case 7: r ^= 50; break;
  }
  return r;
}
function someLeaveItAlone(k: number, r: number): number {
  switch (k) {
    case 0: r = (r + 100) | 0; break;
    case 1: r = (r + 2000) | 0; break;
    case 2: break;
    case 3: r = (r + 70000) | 0; break;
    case 4: r = (r + -5) | 0; break;
    case 5: r = (r + 6) | 0; break;
    case 6: break;
    case 7: r = (r + 8) | 0; break;
  }
  return r;
}
function mixed(k: number, r: number): number {
  switch (k) {
    case 0: r ^= 1; break;
    case 1: r |= 2; break;
    case 2: r ^= 5; break;
    case 3: r = 10; break;
    case 4: r ^= 17; break;
    case 5: r ^= 26; break;
    case 6: r ^= 37; break;
    case 7: r ^= 50; break;
  }
  return r;
}
function fractions(k: number): number {
  switch (k) {
    case 0: return 0.5;
    case 1: return 1;
    case 2: return 4294967296;
    case 3: return -0;
    case 4: return 5;
    case 5: return 9007199254740991;
    case 6: return 2;
    case 7: return NaN;
    default: return 8;
  }
}
const keys: number[] = [];
for (let k = -6; k < 24; ++k) keys.push(k);
keys.push(2147483647, -2147483648, 1.5, NaN, 4294967296, -0);
const lines: string[] = [];
for (let round = 0; round < 3; ++round) {
  let r = round;
  const row: (number | string)[] = [];
  for (const k of keys) {
    r = masked(k, r);
    r = someLeaveItAlone(k, r);
    r = mixed(k, r);
    row.push(small(k), wide(k), signed(k), Object.is(fractions(k), -0) ? "-0" : fractions(k), r);
  }
  lines.push(row.join(" "));
}
console.log(lines.join("\n"));
