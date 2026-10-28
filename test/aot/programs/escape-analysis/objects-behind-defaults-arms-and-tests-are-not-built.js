// Objects that never need to be built: an options bag behind a default, objects of one layout made in the arms of a switch, an optional result that is asked many times, a fresh closure that goes through call().
// STATISTIC: AggregateParametersPromoted = 5
// STATISTIC: MaxVirtualObjectVariantsHits = 0
// STATISTIC: AllocationsRemoved >= 26
const which = process.argv[2] || "all";
const turns = Number(process.argv[3] || 20000);

function plain({ a, b }, n) {
  if (n === 0) return (a * 31 + b) | 0;
  return (plain({ a: (a + n) | 0, b: (b ^ n) | 0 }, n - 1) + 1) | 0;
}
function defaultNeverUsed({ c, d } = {}, n) {
  if (n === 0) return (c * 31 + d) | 0;
  return (defaultNeverUsed({ c: (c + n) | 0, d: (d ^ n) | 0 }, n - 1) + 1) | 0;
}
function defaultUsedOnce({ e, f } = {}, n) {
  if (n === 0) return (e * 31 + f) | 0;
  return (defaultUsedOnce({ e: (e + n) | 0, f: (f ^ n) | 0 }, n - 1) + 1) | 0;
}
function orEmpty(bag, n) {
  bag = bag || {};
  const g = bag.g, h = bag.h;
  if (n === 0) return (g * 31 + h) | 0;
  return (orEmpty({ g: (g + n) | 0, h: (h ^ n) | 0 }, n - 1) + 1) | 0;
}

function each(list, fn, self) {
  for (let i = 0; i < list.length; i++) fn.call(self, list[i], i);
}
let seen = 0;
function odd(x) { seen = (seen + x) | 0; }
odd[process.argv.length > 99 ? "call" : "tag"] = 1;
function sumWith(list, k) {
  let t = 0;
  each(list, function (x) { t = (t + x * k) | 0; }, undefined);
  return t;
}

function twoArms(c, x, y) {
  const p = c ? { x: x, y: y } : { x: y, y: x };
  return (p.x * 3 + p.y) | 0;
}
function nineArms(k, x, y) {
  let p;
  switch (k) {
    case 0: p = { x: x, y: y }; break;
    case 1: p = { x: y, y: x }; break;
    case 2: p = { x: x + 1, y: y }; break;
    case 3: p = { x: y + 1, y: x }; break;
    case 4: p = { x: x + 2, y: y }; break;
    case 5: p = { x: y + 2, y: x }; break;
    case 6: p = { x: x + 3, y: y }; break;
    case 7: p = { x: y + 3, y: x }; break;
    default: p = { x: x + 4, y: y }; break;
  }
  return (p.x * 3 + p.y) | 0;
}

function find(i) {
  return i & 3 ? { v: i, w: i + 1 } : undefined;
}
function askedFiveTimes(i, m) {
  const r = find(i);
  let t = 0;
  if (r) t = (t + r.v) | 0;
  t = (t * m + 1) | 0;
  if (r) t = (t + r.w) | 0;
  t = (t * m + 2) | 0;
  if (r) t = (t ^ r.v) | 0;
  t = (t * m + 3) | 0;
  if (r) t = (t ^ r.w) | 0;
  t = (t * m + 4) | 0;
  if (r) t = (t - r.v) | 0;
  t = (t * m + 5) | 0;
  if (r) t = (t - r.w) | 0;
  return t;
}

function invoke(fn, self, x) {
  return fn.call(self, x);
}
function odder(x) { seen = (seen + x) | 0; return seen; }
odder[process.argv.length > 99 ? "call" : "tag"] = 1;
function throughCall(i, k) {
  return invoke(function (x) { return (x * k + 1) | 0; }, undefined, i);
}
function invokePlainly(fn, x) {
  return fn(x);
}
function withoutCall(i, k) {
  return invokePlainly(function (x) { return (x * k + 1) | 0; }, i);
}

function fieldsExpected({ p, q }, n) {
  if (n === 0) return (p * 31 + q) | 0;
  return (fieldsExpected({ p: (p + n) | 0, q: (q ^ n) | 0 }, n - 1) + 1) | 0;
}
const strange = { p: 1, q: 2 };
strange.p = JSON.parse('"x"');
strange.q = JSON.parse('"y"');

function askedTenTimes(i, m) {
  const r = find(i);
  let t = 0;
  if (r) t = (t + r.v) | 0;
  t = (t * m + 1) | 0;
  if (r) t = (t + r.w) | 0;
  t = (t * m + 2) | 0;
  if (r) t = (t ^ r.v) | 0;
  t = (t * m + 3) | 0;
  if (r) t = (t ^ r.w) | 0;
  t = (t * m + 4) | 0;
  if (r) t = (t - r.v) | 0;
  t = (t * m + 5) | 0;
  if (r) t = (t - r.w) | 0;
  t = (t * m + 6) | 0;
  if (r) t = (t + r.v) | 0;
  t = (t * m + 7) | 0;
  if (r) t = (t + r.w) | 0;
  t = (t * m + 8) | 0;
  if (r) t = (t ^ r.v) | 0;
  t = (t * m + 9) | 0;
  if (r) t = (t ^ r.w) | 0;
  return t;
}

function makeCallback(k) {
  return function (x) { return (x * k + 1) | 0; };
}
const marked = makeCallback(5);
marked[process.argv.length > 99 ? "call" : "tag"] = 1;
function throughCallOfAMarkedKind(i, k) {
  return invoke(makeCallback(k), undefined, i);
}

let kept = null;
function armsThenKept(c, x, y) {
  const p = c ? { x: x, y: y } : { x: y, y: x };
  if (x === -1) kept = p;
  return (p.x * 3 + p.y) | 0;
}
function emptyLists(c, x) {
  const list = c ? [] : [];
  list.push(x);
  if (c) list.push(x + 1);
  return list.length + list[0];
}

const sections = {
  plain(i) { return plain({ a: i, b: 2 }, 8); },
  defaultNeverUsed(i) { return defaultNeverUsed({ c: i, d: 2 }, 8); },
  defaultUsedOnce(i) { return defaultUsedOnce({ e: i, f: 2 }, 8); },
  orEmpty(i) { return orEmpty({ g: i, h: 2 }, 8); },
  sumWith(i) { return sumWith(numbers, i); },
  twoArms(i) { return twoArms((i & 1) === 0, i, 7); },
  nineArms(i) { return nineArms(i % 9, i, 7); },
  askedFiveTimes(i) { return askedFiveTimes(i, 31); },
  throughCall(i) { return throughCall(i, 3); },
  withoutCall(i) { return withoutCall(i, 3); },
  fieldsExpected(i) { return fieldsExpected({ p: i, q: 2 }, 8); },
  askedTenTimes(i) { return askedTenTimes(i, 31); },
  throughCallOfAMarkedKind(i) { return throughCallOfAMarkedKind(i, 3); },
  armsThenKept(i) { return armsThenKept((i & 1) === 0, i, 7); },
  emptyLists(i) { return emptyLists((i & 1) === 0, i); },
};
const numbers = [1, 2, 3, 4];

console.log("once", defaultUsedOnce(undefined, 0), orEmpty(undefined, 0), orEmpty(0, 0));
each(numbers, odd, undefined);
console.log("odd", seen, odd.tag, invoke(odder, undefined, 5), odder.tag, invoke(marked, undefined, 2), marked.tag);
console.log("strange", fieldsExpected(strange, 0), fieldsExpected(strange, 1));
console.log("kept", armsThenKept(true, -1, 4), kept.x, kept.y, armsThenKept(false, -1, 4), kept.x, kept.y);
for (const name of Object.keys(sections)) {
  if (which !== "all" && which !== name) continue;
  const section = sections[name];
  let total = 0;
  for (let i = 0; i < turns; i++) total = (total + section(i)) | 0;
  console.log(name, total);
}
