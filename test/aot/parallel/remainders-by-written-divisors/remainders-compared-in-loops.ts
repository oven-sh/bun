// STATISTIC: MultiplesTestedWithoutRemainder >= 12
// A remainder by a written divisor that is only compared, or only asked for its truth, in a loop: over int32s, wider integers, fractions, zeros of both signs, infinities, NaN and what is no number.
const ints = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 21, 30, 31, 32, 33, 45, 60, 99, 100, 999, 1000, 1001, 2000, 1073741824, 2147483640, 2147483645, 2147483646, 2147483647, -1, -2, -3, -4, -5, -6, -7, -10, -12, -15, -16, -30, -1000, -1024, -1073741824, -2147483640, -2147483646, -2147483647, -2147483648];
const wides = [2147483648, 2147483650, 4294967295, 4294967296, 4294967298, 12884901888, 1700000000000, 1700000003600, 9007199254740990, 9007199254740991, 9007199254740992, 1e18, 9223372036854775807, 18446744073709551616, 1e100, -2147483649, -2147483650, -4294967296, -12884901888, -9007199254740991, -9223372036854775808, -1e20];
const fractions = [0.5, 1.5, 2.5, 3.0000000000000004, 2.9999999999999996, 6.000000000000001, 7.25, 0.1, 5e-324, 999.9999999999999, 2147483647.5, 4294967295.5, -0.5, -1.5, -2.9999999999999996, -7.25, -5e-324, -2147483648.5];
const odd = [NaN, Infinity, -Infinity, -0, 0, 6, -6, 2.5];
const lists: number[][] = [ints, wides, fractions, odd, [...ints, NaN], [...ints, 0.5, -0], [...wides, undefined as unknown as number], [null, 3, "6", true] as unknown as number[], [, 3, , 6] as number[]];

const tests: [string, (list: number[]) => number, (r: number) => boolean, number][] = [
  ["% 3 === 0", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 3 === 0) n += i + 1; return n; }, r => r === 0, 3],
  ["% 3 !== 0", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 3 !== 0) n += i + 1; return n; }, r => r !== 0, 3],
  ["0 == % -6", list => { let n = 0; for (let i = 0; i < list.length; i++) if (0 == list[i]! % -6) n += i + 1; return n; }, r => r === 0, -6],
  ["% 7 === 1", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 7 === 1) n += i + 1; return n; }, r => r === 1, 7],
  ["% 7 === -6", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 7 === -6) n += i + 1; return n; }, r => r === -6, 7],
  ["% 12 === 10", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 12 === 10) n += i + 1; return n; }, r => r === 10, 12],
  ["truth % 1000", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 1000) n += i + 1; return n; }, r => !!r, 1000],
  ["not % 60", list => { let n = 0; for (let i = 0; i < list.length; i++) if (!(list[i]! % 60)) n += i + 1; return n; }, r => !r, 60],
  ["truth % 2", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 2) n += i + 1; return n; }, r => !!r, 2],
  ["% 2 === 1", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 2 === 1) n += i + 1; return n; }, r => r === 1, 2],
  ["% 2 === -1", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 2 === -1) n += i + 1; return n; }, r => r === -1, 2],
  ["% 16 === -4", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 16 === -4) n += i + 1; return n; }, r => r === -4, 16],
  ["% 2 ** 30 === 0", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 1073741824 === 0) n += i + 1; return n; }, r => r === 0, 1073741824],
  ["% (2 ** 31 - 1) === 0", list => { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]! % 2147483647 === 0) n += i + 1; return n; }, r => r === 0, 2147483647],
  ["for of % 5 === 0", list => { let n = 0, i = 0; for (const x of list) { i++; if (x % 5 === 0) n += i; } return n; }, r => r === 0, 5],
  ["for of % 4", list => { let n = 0, i = 0; for (const x of list) { i++; if (x % 4) n += i; } return n; }, r => !!r, 4],
];
let differ = 0;
for (const [name, loop, holds, divisor] of tests) {
  const counts: number[] = [];
  for (const list of lists) for (let turn = 0; turn < 3; turn++) {
    const found = loop(list);
    let expected = 0;
    Array.from(list).forEach((x, i) => { if (holds((x as number) % divisor)) expected += i + 1; });
    if (found !== expected) { differ++; console.log(name, "differs", found, expected); }
    counts.push(found);
  }
  console.log(name, counts.join(" "));
}
console.log("differ", differ);
