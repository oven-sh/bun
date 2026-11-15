// STATISTIC: NumbersChosenWithoutBranches >= 8
"use strict";
const numbers = new Float64Array([0, -0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 5e-324, -5e-324, 1.7976931348623157e308]);
const words = new BigUint64Array(1);
const viewed = new Float64Array(words.buffer);
const bits = number => ((viewed[0] = number), number !== number ? "NaN" : words[0].toString(16));
const lesser = (a, b) => (a < b ? a : b);
const greater = (a, b) => (a > b ? a : b);
const lesserLast = (a, b) => (a > b ? b : a);
const greaterLast = (a, b) => (a < b ? b : a);
const notLesser = (a, b) => (!(a < b) ? a : b);
const lesserOrEqual = (a, b) => (a <= b ? a : b);
const clampedBelow = a => (a < 0 ? 0 : a);
function magnitude(a) {
  if (a < 0) {
    a = -a;
  }
  return a;
}
function magnitudeAbove(a) {
  return a > 0 ? a : -a;
}
function opposite(a) {
  return a > 0 ? -a : a;
}
function oppositeBelow(a) {
  return a < 0 ? a : -a;
}
function magnitudeFromZero(a) {
  if (0 > a) a = -a;
  return a;
}
function spread(views, count) {
  let sum = 0;
  for (let k = 0; k < count; k++) {
    let x = views[k], y = views[(k + 5) % count];
    if (x < 0) {
      x = -x;
    }
    if (0 > y) y = -y;
    const low = x < y ? x : y;
    const high = x > y ? x : y;
    sum = sum * 0.5 + (high - low);
  }
  return sum;
}
function leastOf(views, count) {
  let least = views[0];
  for (let k = 1; k < count; k++) least = views[k] < least ? views[k] : least;
  return least;
}
function bothOf(views, count) {
  let low = 1e9, high = -1e9, place = 0;
  for (let k = 0; k < count; k++) {
    const x = views[k] * 2;
    low = x < low ? x : low;
    if (x > high) {
      high = x;
      place = k;
    }
  }
  return low + high + place;
}
for (const a of numbers) {
  let line = "";
  for (const b of numbers) line += " " + [lesser, greater, lesserLast, greaterLast, notLesser, lesserOrEqual].map(choose => bits(choose(a, b))).join(",");
  console.log(bits(a), line);
  console.log([clampedBelow, magnitude, magnitudeAbove, opposite, oppositeBelow, magnitudeFromZero].map(choose => bits(choose(a))).join(" "));
}
function clampInto(out, views, count) {
  for (let k = 0; k < count; k++) {
    let x = views[k];
    x = x < -0.5 ? -0.5 : x;
    x = x > 0.5 ? 0.5 : x;
    out[k] = x;
  }
}
function lesserInto(out, views, count) {
  for (let k = 0; k < count; k++) {
    const x = views[k], y = views[(k + 3) % count];
    out[k] = x < y ? x : y;
  }
}
function greaterInto(out, views, count) {
  for (let k = 0; k < count; k++) {
    const x = views[k], y = views[(k + 4) % count];
    out[k] = x < y ? y : x;
  }
}
function magnitudesInto(out, views, count) {
  for (let k = 0; k < count; k++) {
    let x = views[k];
    if (x < 0) x = -x;
    out[k] = x;
  }
}
function oppositesInto(out, views, count) {
  for (let k = 0; k < count; k++) {
    let x = views[k];
    if (x > 0) {
      x = -x;
    }
    out[k] = x;
  }
}
function distancesInto(out, views, count) {
  for (let k = 0; k < count; k++) {
    let x = views[k] - views[(k + 1) % count], y = views[(k + 2) % count] - 1;
    if (0 > x) x = -x;
    y = y > 0 ? y : -y;
    out[k] = x > y ? x : y;
  }
}
const out = new Float64Array(12);
const shown = () => Array.from(out, bits).join(" ");
clampInto(out, numbers, 12);
console.log(shown());
lesserInto(out, numbers, 12);
console.log(shown());
greaterInto(out, numbers, 12);
console.log(shown());
magnitudesInto(out, numbers, 12);
console.log(shown());
oppositesInto(out, numbers, 12);
console.log(shown());
distancesInto(out, numbers, 12);
console.log(shown());
const finite = new Float64Array([3.5, -2, 8.25, -0, 0, -11, 4, 0.125, 7, -7]);
console.log(spread(finite, 10), leastOf(finite, 10), bothOf(finite, 10), spread(numbers, 6), bits(leastOf(numbers, 12)), bothOf(numbers, 9));
