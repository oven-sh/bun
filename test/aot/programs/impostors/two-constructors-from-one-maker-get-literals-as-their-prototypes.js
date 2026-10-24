function create() {
  return function (value) {
    this.initialize(value);
  };
}
const Color = create();
Color.prototype = {
  initialize(red) {
    this.red = red;
  },
};
const Light = create();
Light.prototype = {
  initialize(power) {
    this.power = power * 2;
  },
};
console.log(new Color(0.5).red, new Light(3).power);
