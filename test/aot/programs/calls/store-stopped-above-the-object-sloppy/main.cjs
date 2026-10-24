// A sloppy store under a name that the object inherits as a getter without a setter, or as a read-only property, does nothing: the object gets no property of its own.
function GetterAbove() {
  this.count = 10;
  this.run = 5;
}
Object.defineProperty(GetterAbove.prototype, "run", {
  get() {
    return "getter " + this.count;
  },
});
console.log("getter above:", new GetterAbove().run, Object.hasOwn(new GetterAbove(), "run"), Object.keys(new GetterAbove()).join());

function FrozenAbove() {
  this.run = 5;
  this.count = 11;
}
FrozenAbove.prototype.run = function () {
  return "method " + this.count;
};
console.log("before the freeze:", new FrozenAbove().run, Object.hasOwn(new FrozenAbove(), "run"));
Object.freeze(FrozenAbove.prototype);
console.log("frozen above:", new FrozenAbove().run(), Object.hasOwn(new FrozenAbove(), "run"), Object.keys(new FrozenAbove()).join());

function ReadOnlyAbove() {
  this.run = 5;
}
Object.defineProperty(ReadOnlyAbove.prototype, "run", { value: "read-only", writable: false });
console.log("read-only above:", new ReadOnlyAbove().run, Object.hasOwn(new ReadOnlyAbove(), "run"));

function MethodAbove() {
  this.run = 5;
}
MethodAbove.prototype.run = function () {};
console.log("method above:", new MethodAbove().run, Object.hasOwn(new MethodAbove(), "run"));
