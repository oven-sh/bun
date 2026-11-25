class Gauge { constructor(level) { this.level = level; try { this.limit = level; } catch (error) { this.refused = error instanceof TypeError; } } }
Object.defineProperty(Gauge.prototype, "limit", { value: 10 });
let said = 0, refused = 0, own = 0;
for (let turn = 0; turn < 3000; turn++) { const gauge = new Gauge(turn & 7); said = (said + gauge.limit + gauge.level) % 1000003; if (gauge.refused) refused++; if (Object.hasOwn(gauge, "limit")) own++; }
console.log(said, refused, own);
