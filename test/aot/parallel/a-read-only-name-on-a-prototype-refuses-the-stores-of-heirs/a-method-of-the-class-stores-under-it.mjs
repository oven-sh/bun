class Gauge { constructor(level) { this.level = level; } raise(by) { try { this.limit = by; return "stored"; } catch (error) { return error instanceof TypeError ? "throws" : "other"; } } }
Object.defineProperty(Gauge.prototype, "limit", { value: 10, enumerable: true });
let said = "", sum = 0;
for (let turn = 0; turn < 2000; turn++) { const gauge = new Gauge(turn & 7); const answer = gauge.raise(turn); sum = (sum + gauge.limit) % 1000003; if (turn === 0 || turn === 1999) said += answer + " "; }
console.log(said, sum);
