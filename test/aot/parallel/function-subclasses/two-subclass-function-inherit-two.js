// One class is defined before the function gets another prototype object and one after. Each inherits from the object that the function had then.
function Above() {
  this.size;
}
Above.prototype.describe = function () {
  return "first";
};
new Above();
class Early extends Above {
  describe() {
    return "early " + super.describe();
  }
}
console.log(new Early().describe());
Above.prototype = Object.create({
  describe() {
    return "second";
  },
});
class Late extends Above {
  describe() {
    return "late " + super.describe();
  }
}
for (let turn = 0; turn < 3; turn++) console.log(new Early().describe(), new Late().describe(), new Above().describe());
console.log(Object.getPrototypeOf(Early.prototype) === Object.getPrototypeOf(Late.prototype), new Early() instanceof Above, new Late() instanceof Above);
