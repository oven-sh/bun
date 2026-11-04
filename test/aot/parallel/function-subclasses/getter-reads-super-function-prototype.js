// The function makes an object, then gets another prototype object, which only inherits the getter. A class defined after that inherits from the new object.
function Above() {
  this.size;
}
Object.defineProperty(Above.prototype, "label", {
  get() {
    return "first";
  },
  configurable: true,
});
new Above();
Above.prototype = {
  __proto__: {
    get label() {
      return "second";
    },
  },
};
class Below extends Above {
  get label() {
    return super.label;
  }
}
console.log(new Below().label);
