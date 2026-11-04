function Shape() { this.side = 2; }
class Round extends Shape {}
Shape.prototype = { name() { return "shape"; } };
Object.getPrototypeOf(Round.prototype).area = function () { return 7; };
function measure() { return new Shape().area(); }
function named() { return new Shape().name(); }
const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
let said = "";
for (let i = 0; i < 300; i++) said = String(attempt(measure)) + " " + String(attempt(named));
console.log(said, typeof new Shape().area, new Round().area(), typeof new Round().name);
