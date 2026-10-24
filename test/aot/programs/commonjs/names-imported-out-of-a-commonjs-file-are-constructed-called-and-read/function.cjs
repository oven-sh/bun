function double(x) {
  return x * 2;
}
double.Inner = function Inner(value) {
  this.value = value;
};
double.version = "1";
module.exports = double;
