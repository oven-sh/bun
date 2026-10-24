const makers = [function () {}];
const Color = makers[0];
Color.prototype = {
  brightness() {
    return 0.5;
  },
};
console.log(new Color().brightness());
