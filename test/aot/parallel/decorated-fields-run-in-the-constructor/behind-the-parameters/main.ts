const order: string[] = [];
function note<T>(label: string, value: T): T { order.push(label); return value; }
function mark(_target: unknown, _key: string) {}
class Gauge {
  plain = note("plain field", 0);
  @mark level = note("decorated field", 1);
  constructor(step = note("parameter", 1)) { order.push("body"); }
}
new Gauge();
console.log(order.join(" < "));
