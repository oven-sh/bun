function create() {
  return function () {};
}
const Color = create();
Color.prototype = {
  brightness() {
    return 0.5;
  },
};
console.log(new Color().brightness());
