const Class = {
  create() {
    return function () {
      this.initialize.apply(this, arguments);
    };
  },
};
const Color = Class.create();
Color.prototype = {
  red: 0,
  initialize(red) {
    this.red = red;
  },
};
console.log(new Color(0.5).red);
