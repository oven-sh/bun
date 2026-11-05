const order: string[] = [];
function note<T>(label: string, value: T): T { order.push(label); return value; }
function mark(_target: unknown, _key: string) {}
const unseen: (value: number) => number = (0, eval)("(value) => value");
class Gauge {
  plain = note("plain field", unseen(0));
  @mark level = note("decorated field", unseen(1));
  @mark made = new.target === undefined ? "undefined" : (new.target as any).name;
  @mark seen = eval("typeof step + ' ' + typeof new.target");
  constructor(step = note("parameter", 1)) { order.push("body"); }
}
const gauge = new Gauge();
console.log(order.join(" < "), gauge.made, gauge.seen);
