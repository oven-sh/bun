const seen = [];
try {
  seen.push(new Gauge().mode);
} catch (error) {
  seen.push(error.name);
}
var warm = true;
class Gauge {
  mode = warm ? "late" : "early";
  nested = { inner: [warm ? "late" : "early"] };
}
seen.push(new Gauge().mode, new Gauge().nested.inner[0]);
console.log(seen.join());
