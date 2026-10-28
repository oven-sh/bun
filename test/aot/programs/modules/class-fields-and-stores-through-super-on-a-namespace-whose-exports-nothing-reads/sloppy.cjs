module.exports = {
  storesTheSameValue() {
    super.a5 = 5;
    return "stored";
  },
  storesAnotherValue() {
    super.a6 = 7;
    return "stored";
  },
  storesANewName() {
    super.missing = 1;
    return "stored";
  },
};
