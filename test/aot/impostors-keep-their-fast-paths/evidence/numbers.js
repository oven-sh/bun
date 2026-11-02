import { numbersUpTo, parsed } from "./out-of-sight.js";

function multiplyAndSubtract(a, b) {
  return a * b - a;
}

function arithmetic(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += multiplyAndSubtract(list[i], list[i + 1]);
  return total;
}

function maskAndShift(a, b) {
  return ((a | 0) & 255) ^ (b << 2);
}

function bitwise(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += maskAndShift(list[i], list[i + 1]);
  return total;
}

function countUp(start) {
  for (let i = 0; i < 100; i++) start++;
  return start;
}

function addOne(value) {
  return value + 1;
}

function addition(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += addOne(list[i]);
  return total;
}

function isBelowTen(value) {
  return value < 10;
}

function comparisonWithNumber(list) {
  let count = 0;
  for (let i = 0; i < 100; i++) if (isBelowTen(list[i])) count++;
  return count;
}

function negate(value) {
  return -value;
}

function negation(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += negate(list[i]);
  return total;
}

function growBy(total, step) {
  total += step;
  total -= 1;
  return total;
}

function compoundStores(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total = growBy(total, list[i]);
  return total;
}

function halveIfNumber(value) {
  if (typeof value === "number") return value / 2;
  return 0;
}

function narrowedByTypeof(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += halveIfNumber(list[i]);
  return total;
}

function roundedDown(list) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += Math.floor(list[i] / 3);
  return total;
}

export const cases = {
  "Math.floor is called": { prepare: () => numbersUpTo(100), turn: roundedDown },
  "operands of * and -": { prepare: () => numbersUpTo(101), turn: arithmetic },
  "operands of | & ^ <<": { prepare: () => numbersUpTo(101), turn: bitwise },
  "a parameter is incremented": { prepare: () => parsed("5"), turn: countUp },
  "a value is added to a number": { prepare: () => numbersUpTo(100), turn: addition },
  "a value is compared with a number": { prepare: () => numbersUpTo(100), turn: comparisonWithNumber },
  "a value is negated": { prepare: () => numbersUpTo(100), turn: negation },
  "a parameter is stored to with += and -=": { prepare: () => numbersUpTo(100), turn: compoundStores },
  "a value is narrowed by typeof": { prepare: () => numbersUpTo(100), turn: narrowedByTypeof },
};
