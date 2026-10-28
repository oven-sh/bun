// The function is only a parent: nothing constructs it. Its method is deleted before the class below is defined, and the method of the class also asks Reflect.get for the name.
function Above() {
  this.size = 1;
}
Above.prototype.describe = function () {
  return "first";
};
delete Above.prototype.describe;
class Below extends Above {
  run() {
    Reflect.get(this, "describe");
    return super.describe();
  }
}
try {
  console.log(new Below().run());
} catch (error) {
  console.log(error.name);
}
