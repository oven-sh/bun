// `Shape.prototype.area = function () { .. }`, and a store outside the constructor gives one object an `area` of its own: calls by name enter that one on that object alone, until it is deleted
function Shape(side) { this.side = side; }
Shape.prototype.area = function () { return this.side * this.side; };
function measure(shape) { return shape.area(); }
function deed(shape) { shape.area = function () { return -this.side; }; }
const plain = new Shape(3);
const hidden = new Shape(4);
console.log(measure(plain), measure(hidden));
deed(hidden);
console.log(measure(plain), measure(hidden), Object.keys(plain).join(), Object.keys(hidden).join());
let sum = 0;
for (let turn = 0; turn < 300; turn++)
    sum += measure(plain) + measure(hidden);
console.log(sum);
delete hidden.area;
console.log(measure(plain), measure(hidden), Object.keys(hidden).join());
