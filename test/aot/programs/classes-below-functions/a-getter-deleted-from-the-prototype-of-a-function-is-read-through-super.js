// The function is only a parent: nothing constructs it. Its getter is deleted after the class below is defined, and the method of the class also asks Reflect.get for the name.
function Above() {
  this.size = 1;
}
Object.defineProperty(Above.prototype, "label", {
  get() {
    return "first";
  },
  configurable: true,
});
class Below extends Above {
  run() {
    Reflect.get(this, "label");
    return super.label;
  }
}
console.log(new Below().run());
delete Above.prototype.label;
console.log(new Below().run());
