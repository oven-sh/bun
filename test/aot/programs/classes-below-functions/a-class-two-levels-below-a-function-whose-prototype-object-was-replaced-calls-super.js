// The function makes an object and then gets another prototype object, which only inherits the method. Two classes, one below the other, are defined after that.
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
class Middle extends Above {
  describe() {
    return super.describe();
  }
}
class Below extends Middle {
  describe() {
    return "below " + super.describe();
  }
}
for (let turn = 0; turn < 3; turn++) console.log(new Below().describe(), new Middle().describe());
