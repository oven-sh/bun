function Shape() {}
class Round extends Shape {}
Shape.prototype = {};
Round.prototype.__proto__.area = function () { return 7; };
Shape.prototype.area = function () { return 8; };
function measure() { return new Shape().area(); }
function measureRound() { return new Round().area(); }
let a = 0, b = 0;
for (let i = 0; i < 300; i++) { a += measure(); b += measureRound(); }
console.log(a, b);
