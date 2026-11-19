// STATISTIC: MethodCallsThroughTable = 0
interface Gauge { whole(): number; part(): number }
class Dial implements Gauge { constructor(readonly at: number) {} whole() { return this.at | 0; } part() { return this.at / 3; } }
class Rule implements Gauge { constructor(readonly at: number) {} whole() { return (this.at * 2) | 0; } part() { return this.at / 7; } }
class Level implements Gauge { constructor(readonly at: number) {} whole() { return (this.at + 9) | 0; } part() { return this.at * 0.125; } }
const gauges: Gauge[] = [new Dial(10), new Rule(20), new Level(30)];
let whole = 0, part = 0;
for (let turn = 0; turn < 300; turn++) { const gauge = gauges[turn % 3]; whole += gauge.whole(); part += gauge.part(); }
console.log(whole, part.toFixed(6));
