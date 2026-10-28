this.viaThis = 1;
exports.viaExports = 2;
exports.same = this === exports && this === module.exports;
exports.inFunction = (function () { return this === globalThis; })();
exports.typeOfThis = typeof this;
exports.keptOffTheGlobalObject = !("viaThis" in globalThis);

this.second = exports.first = 3;
exports.readBeforeItsStore = [this.later, "later" in this, Object.keys(this).includes("later")];
this.later = 4;
this.viaExports += 10;
for (this.lastOfLoop of [5, 6]);
for (this.lastKeyOfLoop in { a: 0, b: 0 });

Object.defineProperty(this, "readOnly", { value: 7, enumerable: true });
Object.defineProperty(this, "getterOnly", { enumerable: true, get() { return this === exports; } });
this.readOnly = 8;
this.getterOnly = 9;
exports.deleteOfReadOnly = delete this.readOnly;

function fill() {
  this.viaReceiver = 10;
  this.filledByFunction = 11;
  return this;
}
exports.receivers = [fill.call(this) === exports, typeof fill.call(12), fill.call(12).viaReceiver];
exports.fill = fill;
exports.receiverOfMethod = this.fill() === exports;
exports.filledByFunction++;

with (this) {
  viaThis += 100;
  var readInWith = second;
}
exports.readInWith = readInWith;

this.storeAfterPreventingExtensions = "not tried";
Object.preventExtensions(this);
this.tooLate = 12;
this.storeAfterPreventingExtensions = "tooLate" in this ? "stored" : "dropped";
