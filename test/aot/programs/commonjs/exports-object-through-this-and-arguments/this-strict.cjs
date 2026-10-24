"use strict";
this.viaThis = 1;
exports.viaExports = 2;
this.viaExports += 10;
exports.same = this === exports && this === module.exports;
exports.inFunction = (function () { return this; })();
exports.typeOfThis = typeof this;

this.storedLast = exports.storedSecond = module.exports.storedFirst = void 0;
this["storedByText"] = 3;
({ a: this.fromPattern, b: [this.fromNestedPattern = 5] } = { a: 4, b: [] });
this.fromIncrement++;
this.fromLogicalAssignment ??= 6;
this.neverCreated &&= 7;
this.viaThis ||= 8;
exports.removed = 9;
exports.deleted = delete this.removed;
this.removed = "created again";

Object.defineProperty(this, "readOnly", { value: 10, enumerable: true });
Object.defineProperty(this, "getterOnly", { enumerable: true, get() { return this === exports; } });
try {
  this.readOnly = 11;
} catch (error) {
  this.storeToReadOnly = error.constructor.name;
}
try {
  this.getterOnly = 12;
} catch (error) {
  this.storeToGetterOnly = error.constructor.name;
}
try {
  delete this.readOnly;
} catch (error) {
  this.deleteOfReadOnly = error.constructor.name;
}

class Holder {
  static self = this;
  static {
    this.inStaticBlock = 13;
  }
  field = this;
  [(this.inComputedKey = "method")]() {
    return this;
  }
}
class Derived extends (this.inHeritage = Holder) {}
const held = new Derived();
exports.inClasses = [Holder.self === Holder, Holder.inStaticBlock, "inStaticBlock" in this, held.field === held, held.method() === held];

const literal = {
  value: this,
  arrow: () => this,
  method() {
    return this;
  },
  get accessor() {
    return this;
  },
};
const { method } = literal;
exports.inLiteral = [literal.value === exports, literal.arrow() === exports, literal.method() === literal, literal.accessor === literal, method()];
exports.inArrows = [(() => this)() === exports, ((value = this) => value)() === exports, (() => () => typeof this)()()];

exports.receiver = function receiver() {
  return this;
};
exports.receivers = [this.receiver() === this, (0, this.receiver)(), this.receiver.call(14)];

exports.readThroughThis = [this.viaThis, this.viaExports, this.storedFirst, this.storedByText, this.fromPattern, this.fromNestedPattern, this.fromIncrement, this.fromLogicalAssignment, this.neverCreated, "neverCreated" in this, this.removed, this.readOnly, this.getterOnly, this.inComputedKey];

this.storeAfterPreventingExtensions = "no error";
Object.preventExtensions(this);
try {
  this.tooLate = 15;
} catch (error) {
  this.storeAfterPreventingExtensions = error.constructor.name;
}
