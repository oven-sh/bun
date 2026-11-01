// `new Base()` answers what Base returns where that is an object, and the new object where it is anything else.
const other = { other: true };
function ReturnsObject() {
  this.lost = 1;
  return other;
}
function ReturnsNumber() {
  this.kept = 1;
  return 5;
}
function ReturnsFunction() {
  this.lost = 1;
  return ReturnsNumber;
}
function First() {}
function Second() {}
function Third() {}
First.prototype = new ReturnsObject();
Second.prototype = new ReturnsNumber();
Third.prototype = new ReturnsFunction();
console.log(First.prototype === other, Object.keys(First.prototype).join(), new First().other, new First() instanceof ReturnsObject);
console.log(Object.keys(Second.prototype).join(), new Second().kept, new Second() instanceof ReturnsNumber);
console.log(Third.prototype === ReturnsNumber, new Third() instanceof Function, typeof new Third());
