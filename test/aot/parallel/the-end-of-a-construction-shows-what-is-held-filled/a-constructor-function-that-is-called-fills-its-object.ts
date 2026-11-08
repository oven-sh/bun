interface Gauge { low: number; high: number; unit: string; on: boolean; note: string; step: number; }
function GaugeF(this: Gauge, low: number, high: number, unit: string) {
  let work = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) work = (work + i * k) | 0;
  this.low = low; this.high = high; this.unit = unit; this.on = low < high; this.note = unit + work; this.step = (high - low) / 4;
}
const Gauge = GaugeF as unknown as { new (low: number, high: number, unit: string): Gauge };
function span(g: Gauge): string { return g.low + ".." + g.high + g.unit + (g.on ? " on " : " off ") + g.note + " " + g.step; }
let text = "";
for (let i = 0; i < 300; i++) text = span(new Gauge(i, 300 - i, "m"));
console.log(text);
const makers = [Gauge];
console.log(span(new makers[JSON.parse("0")](1, 9, "s")));
console.log(span(Reflect.construct(Gauge, [2, 6, "k"])));
export {};
