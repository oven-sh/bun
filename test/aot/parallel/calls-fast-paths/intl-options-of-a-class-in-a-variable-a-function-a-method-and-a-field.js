class Options {
  get minimumFractionDigits() {
    return 3;
  }
}
const kept = new Options();
function inAFunction(value) {
  return new Intl.NumberFormat("en", new Options()).format(value);
}
class Formats {
  field = new Intl.NumberFormat("en", new Options()).format(1.5);
  method(value) {
    return new Intl.NumberFormat("en", new Options()).format(value);
  }
}
const formats = new Formats();
console.log(new Intl.NumberFormat("en", kept).format(1.5));
console.log(inAFunction(1.5));
console.log(formats.method(1.5));
console.log(formats.field);
