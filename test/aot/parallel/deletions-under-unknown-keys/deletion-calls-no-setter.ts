const keyOfX: string = JSON.parse('"x"');
const keyOfExtra: string = JSON.parse('"extra"');
const keyOfZero: string = JSON.parse('"0"');
const turns: number = JSON.parse("3");
let calls = 0;
class Gauge {
  level = 1;
  set mark(value: number | undefined) {
    calls++;
    this.level = value ?? -1;
  }
}
function empty(gauge: Gauge, key: string) {
  return delete (gauge as any)[key];
}
const gauge = new Gauge();
console.log(empty(gauge, JSON.parse('"mark"')), calls, gauge.level);
console.log(empty(gauge, JSON.parse('"level"')), calls, gauge.level, Object.keys(gauge).length);
gauge.mark = 7;
console.log(calls, gauge.level);
