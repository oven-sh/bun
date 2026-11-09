const seen = [];
try {
  seen.push(...new Gauge().all());
} catch (error) {
  seen.push(error.name);
}
var warm = true;
var count = 3;
var label = "set";
class Gauge {
  negated() {
    if (!warm) return "early";
    return "late";
  }
  kind() {
    return typeof count === "undefined" ? "early" : "late";
  }
  compared() {
    return label === "set" ? "late" : "early";
  }
  chained() {
    return (warm && "late") || "early";
  }
  all() {
    return [this.negated(), this.kind(), this.compared(), this.chained()];
  }
}
seen.push(...new Gauge().all());
console.log(seen.join());
