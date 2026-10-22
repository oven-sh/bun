// What a program does to a prototype object with 200 names behind the lookups that flatten it is noticed like any other change: a method replaced, deleted, hidden, another parent, a default that becomes a setter and then read-only, names deleted in front of the flattening.
function fill(prototype, count) {
  for (let i = 0; i < count; i++) prototype["m" + i] = function () { return i; };
}
function define(prototype, count) {
  for (let i = 0; i < count; i++) Object.defineProperty(prototype, "m" + i, { value: function () { return i; }, writable: true, configurable: true, enumerable: false });
}
// Lookups by name, each of them several times: the first miss of a name files nothing.
function poke(o) {
  let sum = 0;
  for (let j = 0; j < 9; j++) sum += o["m" + (j % 3)]() + o.m5();
  return sum;
}
function WideThenChanged() { this.a = 1; }
WideThenChanged.prototype.hot = function () { return this.a; };
function callHot(o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += o.hot();
  return sum;
}
function wideThenChanged(n) {
  fill(WideThenChanged.prototype, 200);
  const o = new WideThenChanged();
  const seen = [poke(o), callHot(o, n)];
  WideThenChanged.prototype.hot = function () { return this.a + 10; };
  seen.push(callHot(o, n));
  delete WideThenChanged.prototype.hot;
  try {
    seen.push(callHot(o, 1));
  } catch (error) {
    seen.push(error.constructor.name);
  }
  Object.setPrototypeOf(WideThenChanged.prototype, { hot() { return 100; } });
  seen.push(callHot(o, n));
  o.hot = function () { return 7; };
  seen.push(callHot(o, n));
  return seen.join(",");
}
class WideClassThenChanged {
  constructor() { this.a = 1; }
  hot() { return this.a; }
}
class BelowWideClassThenChanged extends WideClassThenChanged {
  warm() { return this.a + 1; }
}
function callBoth(o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += o.hot() + o.warm();
  return sum;
}
function wideClassThenChanged(n) {
  define(WideClassThenChanged.prototype, 200);
  const o = new BelowWideClassThenChanged();
  const seen = [poke(o), callBoth(o, n)];
  WideClassThenChanged.prototype.hot = function () { return 20; };
  seen.push(callBoth(o, n));
  BelowWideClassThenChanged.prototype.hot = function () { return 30; };
  seen.push(callBoth(o, n));
  Object.setPrototypeOf(BelowWideClassThenChanged.prototype, { hot() { return 40; } });
  delete BelowWideClassThenChanged.prototype.hot;
  seen.push(callBoth(o, n));
  return seen.join(",");
}
function WideThenSetter() { this.a = 1; }
WideThenSetter.prototype.late = 0;
function makeWithLate(i) {
  const o = new WideThenSetter();
  o.late = i;
  return o;
}
function wideThenSetter(n) {
  fill(WideThenSetter.prototype, 200);
  let sum = 0;
  let stored = 0;
  for (let i = 0; i < n; i++) sum += makeWithLate(i).late;
  Object.defineProperty(WideThenSetter.prototype, "late", { set(value) { stored += value; }, get() { return -1; }, configurable: true });
  for (let i = 0; i < n; i++) sum += makeWithLate(i).late;
  Object.defineProperty(WideThenSetter.prototype, "late", { value: 5, writable: false, configurable: true });
  let refused = 0;
  for (let i = 0; i < n; i++) {
    try {
      sum += makeWithLate(i).late;
    } catch (error) {
      refused += error instanceof TypeError ? 1 : 1000;
    }
  }
  return `${sum} ${stored} ${refused}`;
}
// Names are deleted first: the flattening gives the properties that are left other offsets.
function WideWithDeleted() { this.a = 1; }
WideWithDeleted.prototype.hot = function () { return this.a; };
function wideWithDeleted(n) {
  const prototype = WideWithDeleted.prototype;
  fill(prototype, 200);
  const o = new WideWithDeleted();
  let sum = o.m150() + o.m150() + o.m199() + o.m199() + callHotOfDeleted(o, n);
  for (let i = 10; i < 120; i += 2) delete prototype["m" + i];
  sum += poke(o);
  for (let j = 0; j < 4; j++) sum += o.m150() + o.m199() + o.m11() + (o.m12 === undefined ? 1000 : 0);
  return sum + callHotOfDeleted(o, n);
}
function callHotOfDeleted(o, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += o.hot();
  return sum;
}
console.log(wideThenChanged(64));
console.log(wideClassThenChanged(64));
console.log(wideThenSetter(64));
console.log(wideWithDeleted(64));
