class Counter {
  count = 0;
  step(): number {
    this.count = this.count + 1;
    return this.count;
  }
}
interface Settings { a: number; b: number; }
const counter = new Counter();
console.log(counter.step());
delete (counter as any).count;
console.log(counter.step());
const settings: Settings = JSON.parse('{"a":1,"b":2}');
console.log(settings.a + settings.b);
