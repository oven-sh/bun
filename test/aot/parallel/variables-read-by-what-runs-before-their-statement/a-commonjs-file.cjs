let first;
try {
  first = new Gauge().state();
} catch (error) {
  first = error.name;
}
console.log(first);
var warm = true;
class Gauge {
  state() {
    return warm ? "late" : "early";
  }
}
console.log(new Gauge().state());
