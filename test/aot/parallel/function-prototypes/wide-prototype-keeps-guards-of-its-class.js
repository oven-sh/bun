// A prototype object with 200 names is a dictionary, which the run time flattens at a lookup by name. Nothing that the guards of the class speak of changes, so none of them is cleared.
// COUNTER: MemberGuardsCleared = 0
// COUNTER: PrototypeLinkGuardsCleared = 0
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
function WideByKey() { this.a = 1; }
WideByKey.prototype.hot = function () { return this.a; };
function wideByKey(n) {
  fill(WideByKey.prototype, 200);
  const o = new WideByKey();
  let sum = poke(o);
  for (let i = 0; i < n; i++) sum += o.hot();
  return sum;
}
function WideByDefine() { this.a = 1; }
WideByDefine.prototype.hot = function () { return this.a; };
function wideByDefine(n) {
  define(WideByDefine.prototype, 200);
  const o = new WideByDefine();
  let sum = poke(o);
  for (let i = 0; i < n; i++) sum += o.hot();
  return sum;
}
class WideClassByKey {
  constructor() { this.a = 1; }
  hot() { return this.a; }
}
class BelowWideClassByKey extends WideClassByKey {
  warm() { return this.a + 1; }
}
function wideClassByKey(n) {
  fill(WideClassByKey.prototype, 200);
  const o = new BelowWideClassByKey();
  let sum = poke(o);
  for (let i = 0; i < n; i++) sum += o.hot() + o.warm();
  return sum;
}
class WideClassByDefine {
  constructor() { this.a = 1; }
  hot() { return this.a; }
}
class BelowWideClassByDefine extends WideClassByDefine {
  warm() { return this.a + 1; }
}
function wideClassByDefine(n) {
  define(WideClassByDefine.prototype, 200);
  const o = new BelowWideClassByDefine();
  let sum = poke(o);
  for (let i = 0; i < n; i++) sum += o.hot() + o.warm();
  return sum;
}
function WideDefinedWithDefault() { this.a = 1; }
WideDefinedWithDefault.prototype.late = 0;
function wideDefinedWithDefault(n) {
  define(WideDefinedWithDefault.prototype, 200);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = new WideDefinedWithDefault();
    o.late = i;
    sum += o.late + o.a;
    kept = o;
  }
  return sum;
}
let kept = null;
console.log(wideByKey(300), wideByDefine(300), wideClassByKey(300), wideClassByDefine(300), wideDefinedWithDefault(300), kept.late);
