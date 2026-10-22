const parent = {
  double() {
    return this.size * 2;
  },
};
const heir = Object.create(parent);
heir.size = 1.5;
console.log(heir.double() + 1);
