function Shape() {}
class Round extends Shape {}
Shape.prototype = {};
Round.prototype.__proto__.area = function () { return 7; };
function measure() { return new Shape().area(); }
const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
let said = "";
for (let i = 0; i < 300; i++) said = String(attempt(measure));
console.log(said);
