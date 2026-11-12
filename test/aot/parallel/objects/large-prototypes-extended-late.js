// A prototype with more than 128 members is a dictionary. It is read, extended, read and extended again; names that are read for the first time behind that are answered from the caches like all others.
// 240,000 reads and 20,000 stores: without it each of them enters the run time.
// COUNT: operation:operationAOTGetById <= 2000
// COUNT: operation:operationAOTPutById <= 2000
// COUNT: operation:operationAOTPutByIdAndCache <= 2000
"use strict";
const log = [];
const members = 200;
const forms = {
  keys() {
    function Keys(x) { this.x = x; }
    fill(Keys.prototype, members);
    return [Keys.prototype, x => new Keys(x)];
  },
  created() {
    const prototype = fill({}, members);
    return [prototype, x => Object.assign(Object.create(prototype), { x })];
  },
  factory() {
    const make = count => { class Made { constructor(x) { this.x = x; } } fill(Made.prototype, count); return Made; };
    make(3);
    const Made = make(members);
    return [Made.prototype, x => new Made(x)];
  },
  below() {
    class Base { constructor(x) { this.x = x; } }
    fill(Base.prototype, members);
    class Below extends Base { m13() { return super.m13() + 1; } }
    return [Base.prototype, x => new Below(x)];
  },
};
function fill(prototype, count) {
  for (let k = 0; k < count; k++) prototype["m" + k] = function () { return this.x + k; };
  for (const name of ["first", "second"]) Object.defineProperty(prototype, name, { get() { return this.x; }, set(value) { this.x = value & 7; }, configurable: true });
  return prototype;
}
function put(prototype, name, value) { prototype[name] = value; }
function define(prototype, name, value) { Object.defineProperty(prototype, name, { value, writable: true, configurable: true }); }
function early(o, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += o.m1() + o.m2() + (o.nothing ? 1 : 0) + o.first; return sum; }
function later(o, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += o.m4() + o.m6() + (o.nothingYet ? 1 : 0); return sum; }
function last(o, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += o.m11() + o.m12() + o.m13() + (o.neverThere === undefined ? 1 : 0) + ("m14" in o ? 1 : 0) + ("neverIn" in o ? 5 : 0);
    sum += o.second;
    o.second = i;
  }
  return sum;
}
function changes(o, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += (typeof o.m15 === "function" ? o.m15() : 1) + (o.m16?.() ?? 2) + (o.added ?? 3) + (o.addedLater ?? 5) + (o.m17 ? 4 : 5); return sum; }
for (const form of Object.keys(forms)) {
  const [prototype, make] = forms[form]();
  const o = make(1);
  log.push(form, early(o, 300));
  define(prototype, "definedOnce", 1);
  log.push(later(o, 300));
  define(prototype, "definedTwice", 2);
  log.push(last(o, 5000));
  log.push(changes(o, 400));
  put(prototype, "added", 6);
  log.push(changes(o, 400));
  put(prototype, "m15", function () { return this.x + 1000; });
  put(prototype, "m18", 1);
  log.push(changes(o, 400));
  delete prototype.m16;
  log.push(changes(o, 400), changes(make(2), 400));
  put(prototype, "addedLater", 7);
  log.push(changes(o, 400));
  Object.defineProperty(prototype, "m15", { get() { return () => 2000; }, configurable: true });
  log.push(changes(o, 400));
  put(prototype, "m16", function () { return this.x + 3000; });
  for (let k = 20; k < 60; k++) delete prototype["m" + k];
  log.push(changes(o, 400), Object.keys(prototype).length, changes(o, 400));
  Object.setPrototypeOf(prototype, { m17: 0, above() { return 1; } });
  delete prototype.m17;
  log.push(changes(o, 400), o.above());
  Object.freeze(prototype);
  try { o.added = 9; } catch (error) { log.push(error.constructor.name); }
  log.push(changes(o, 400));
}
console.log(log.join("\n"));
