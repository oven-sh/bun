// The function makes an object, then gets another prototype object, which only inherits the method. A class defined after that inherits from the new object.
function Above() {
  this.size;
}
Above.prototype.describe = function () {
  return "first";
};
new Above();
Above.prototype = Object.create({
  describe() {
    return "second";
  },
});
class Below extends Above {
  describe() {
    return super.describe();
  }
}
console.log(new Below().describe());
