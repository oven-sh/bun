const parent = {
  double() {
    return this.size * 2;
  },
};
console.log(Object.setPrototypeOf({ size: 1.5 }, parent).double() + 1);
