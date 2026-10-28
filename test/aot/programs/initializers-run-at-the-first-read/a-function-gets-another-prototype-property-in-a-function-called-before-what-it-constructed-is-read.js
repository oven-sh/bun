// An object is constructed at the top of the file. One function stores to the `prototype` property of its constructor, another reads the object afterwards: it lies below what the constructor had when it was made.
function hide() {}
const Meter = hide;
const meter = new Meter();
function change() {
  Meter.prototype = null;
}
function show() {
  console.log(Object.getPrototypeOf(meter) === Object.prototype);
}
change();
show();
