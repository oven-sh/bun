// "No access of the callee runs code on this object" is a claim about the object's own members and about every object on its chain. Accessors get there by class syntax, by a literal, by defineProperty with a computed key, defineProperties, Reflect.defineProperty, __defineGetter__, copied descriptors (a mixin), a prototype that is put in later, a static block, a base class chosen at run time. Each keeps `this`.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const spyGet = function () {
  kept.push(this);
  return 1000;
};
const spySet = function (value) {
  kept.push(this, value);
};
function readsExtra(o) {
  return o.base + (o.extra === undefined ? 0 : o.extra);
}
function writesExtra(o, v) {
  o.extra = v;
  return o.base;
}
const key = ["ex", "tra"].join("");

class Plain {
  constructor(i, tag) {
    this.base = i;
    this.tag = tag;
  }
}
class BySyntax extends Plain {
  get extra() {
    return spyGet.call(this);
  }
  set extra(v) {
    spySet.call(this, v);
  }
}
class ByDefineProperty extends Plain {}
Object.defineProperty(ByDefineProperty.prototype, "extra", { get: spyGet, set: spySet });
class ByComputedKey extends Plain {}
Object.defineProperty(ByComputedKey.prototype, key, { get: spyGet, set: spySet });
class ByComputedSyntax extends Plain {
  get [key]() {
    return spyGet.call(this);
  }
  set [key](v) {
    spySet.call(this, v);
  }
}
class ByDefineProperties extends Plain {}
Object.defineProperties(ByDefineProperties.prototype, { extra: { get: spyGet, set: spySet } });
class ByReflect extends Plain {}
Reflect.defineProperty(ByReflect.prototype, "extra", { get: spyGet, set: spySet });
class ByOldFunctions extends Plain {}
ByOldFunctions.prototype.__defineGetter__("extra", spyGet);
ByOldFunctions.prototype.__defineSetter__("extra", spySet);
const mixin = {
  get extra() {
    return spyGet.call(this);
  },
  set extra(v) {
    spySet.call(this, v);
  },
};
class ByMixin extends Plain {}
Object.defineProperties(ByMixin.prototype, Object.getOwnPropertyDescriptors(mixin));
class ByStaticBlock extends Plain {
  static {
    Object.defineProperty(this.prototype, "extra", { get: spyGet, set: spySet });
  }
}
class ByParentPutIn extends Plain {}
Object.setPrototypeOf(ByParentPutIn.prototype, Object.create(Plain.prototype, { extra: { get: spyGet, set: spySet } }));
function chooseBase(spying) {
  return spying ? BySyntax : Plain;
}
class ByChosenBase extends chooseBase(key.length === 5) {}
class TwoLevelsUp extends class extends BySyntax {} {}
function OldStyle(i, tag) {
  this.base = i;
  this.tag = tag;
}
OldStyle.prototype = { constructor: OldStyle, get extra() { return spyGet.call(this); }, set extra(v) { spySet.call(this, v); } };
const classes = [BySyntax, ByDefineProperty, ByComputedKey, ByComputedSyntax, ByDefineProperties, ByReflect, ByOldFunctions, ByMixin, ByStaticBlock, ByParentPutIn, ByChosenBase, TwoLevelsUp, OldStyle];

let sum = 0;
for (let i = 0; i < 1000; i++) sum += readsExtra(new Plain(i, "plain")) + writesExtra(new Plain(i, "plain"), i) + readsExtra({ base: i, extra: 1 }) + writesExtra({ base: i }, 1);
console.log(sum);
// One site a class, so that each site knows its object.
sum = 0;
for (let i = 0; i < 3; i++) {
  sum += readsExtra(new BySyntax(i, "syntax " + i)) + writesExtra(new BySyntax(i, "syntax written " + i), { tag: "value" });
  sum += readsExtra(new ByDefineProperty(i, "defineProperty " + i)) + writesExtra(new ByDefineProperty(i, "defineProperty written " + i), { tag: "value" });
  sum += readsExtra(new ByComputedKey(i, "computed key " + i)) + writesExtra(new ByComputedKey(i, "computed key written " + i), { tag: "value" });
  sum += readsExtra(new ByComputedSyntax(i, "computed syntax " + i)) + writesExtra(new ByComputedSyntax(i, "computed syntax written " + i), { tag: "value" });
  sum += readsExtra(new ByDefineProperties(i, "defineProperties " + i)) + writesExtra(new ByDefineProperties(i, "defineProperties written " + i), { tag: "value" });
  sum += readsExtra(new ByReflect(i, "Reflect " + i)) + writesExtra(new ByReflect(i, "Reflect written " + i), { tag: "value" });
  sum += readsExtra(new ByOldFunctions(i, "__defineGetter__ " + i)) + writesExtra(new ByOldFunctions(i, "__defineSetter__ written " + i), { tag: "value" });
  sum += readsExtra(new ByMixin(i, "mixin " + i)) + writesExtra(new ByMixin(i, "mixin written " + i), { tag: "value" });
  sum += readsExtra(new ByStaticBlock(i, "static block " + i)) + writesExtra(new ByStaticBlock(i, "static block written " + i), { tag: "value" });
  sum += readsExtra(new ByParentPutIn(i, "parent put in " + i)) + writesExtra(new ByParentPutIn(i, "parent put in written " + i), { tag: "value" });
  sum += readsExtra(new ByChosenBase(i, "chosen base " + i)) + writesExtra(new ByChosenBase(i, "chosen base written " + i), { tag: "value" });
  sum += readsExtra(new TwoLevelsUp(i, "two levels up " + i)) + writesExtra(new TwoLevelsUp(i, "two levels up written " + i), { tag: "value" });
  sum += readsExtra(new OldStyle(i, "old style " + i)) + writesExtra(new OldStyle(i, "old style written " + i), { tag: "value" });
}
console.log(sum, churn(60), kept.length);
console.log(kept.filter(k => k.tag.endsWith(" 2")).map(k => k.tag).join(" | "));
kept.length = 0;
for (const C of classes) sum += readsExtra(new C(1, "by value " + C.name));
console.log(sum, churn(30), kept.map(k => k.tag).join(" | "));
kept.length = 0;

// Literals.
const chainForLiterals = { get extra() { return spyGet.call(this); }, set extra(v) { spySet.call(this, v); } };
sum = 0;
for (let i = 0; i < 3; i++) {
  sum += readsExtra({ base: i, tag: "own getter " + i, get extra() { return spyGet.call(this); } });
  sum += readsExtra({ __proto__: chainForLiterals, base: i, tag: "literal below a chain " + i });
  sum += readsExtra(Object.create(chainForLiterals, { base: { value: i }, tag: { value: "created below a chain " + i } }));
  sum += readsExtra(Object.setPrototypeOf({ base: i, tag: "moved below a chain " + i }, chainForLiterals));
  sum += readsExtra(Object.defineProperty({ base: i, tag: "defined on the literal " + i }, key, { get: spyGet }));
  sum += readsExtra(Object.assign(Object.create(chainForLiterals), { base: i, tag: "assigned below a chain " + i }));
  sum += writesExtra({ __proto__: chainForLiterals, base: i, tag: "written below a chain " + i }, { tag: "written value " + i });
  sum += readsExtra({ ...{ base: i, tag: "a spread runs the getter and copies the value " + i, get extra() { return spyGet.call(this); } } });
}
console.log(sum, churn(30), kept.map(k => k.tag).join(" | "));
kept.length = 0;

// The accessor arrives after the site has run a thousand times, and leaves again.
class Late extends Plain {}
function lateRound(i) {
  return readsExtra(new Late(i, "late " + i)) + writesExtra(new Late(i, "late written " + i), i);
}
sum = 0;
for (let i = 0; i < 1000; i++) sum += lateRound(i);
Object.defineProperty(Late.prototype, "extra", { get: spyGet, set: spySet, configurable: true });
sum += lateRound(1000);
delete Late.prototype.extra;
sum += lateRound(1001);
Object.defineProperty(Plain.prototype, "extra", { get: spyGet, set: spySet, configurable: true });
sum += lateRound(1002) + readsExtra(new Plain(1003, "plain 1003"));
delete Plain.prototype.extra;
sum += lateRound(1004);
console.log(sum, churn(30), kept.map(k => (typeof k === "object" ? k.tag : k)).join(" | "));
