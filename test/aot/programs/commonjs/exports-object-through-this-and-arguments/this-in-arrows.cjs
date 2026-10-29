const store = (name, value) => { this[name] = value; };
exports.first = 1;
store("second", 2);
const nested = () => () => this;
exports.same = nested()() === exports;
store("first", 3);

const storeLater = () => { this.fromArrow = 4; };
(() => { this.fromCalledArrow = 5; })();
storeLater();
exports.afterTheArrows = 6;
store("stored", () => this === exports);
exports.resultOfStored = exports.stored();

const byDefault = (target = this) => target;
const holder = {
  arrow: () => this,
  method() { return (() => this)(); },
  get getter() { return (() => this)(); },
};
function ofReceiver() { return (() => this)(); }
function fillReceiver() { (() => { this.onReceiver = 7; })(); }
fillReceiver.call(holder);
class Holder {
  static self = (() => this)();
  static { (() => { this.inStaticBlock = 8; })(); }
  field = () => this;
  [(() => this.first)()] = "a computed key is evaluated outside the class";
}
const instance = new Holder();
exports.whereThisIsTheExportsObject = [byDefault() === exports, holder.arrow() === exports, instance[3]];
exports.whereItIsNot = [holder.method() === holder, holder.getter === holder, ofReceiver() === globalThis, ofReceiver.call(holder) === holder, Holder.self === Holder, instance.field() === instance];
exports.storedOnOthers = [Object.keys(holder).join(), Object.keys(Holder).join()];

(async () => {
  this.beforeAwait = 9;
  await null;
  this.afterAwait = 10;
})();
exports.set = (name, value) => { this[name] = value; return this; };
exports.fill = () => { this.filledLater = 11; return Object.keys(this).length; };
