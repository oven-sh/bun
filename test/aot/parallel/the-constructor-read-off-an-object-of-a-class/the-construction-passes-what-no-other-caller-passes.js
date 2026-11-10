// The construction through this.constructor passes a number, a text and an object; the only other caller of the constructor passes 1.
// STATISTIC: ConstructorReadsResolvedToClasses >= 1
class Point { constructor(x) { this.x = x; } again(value) { return new this.constructor(value); } }
const first = new Point(1);
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum += first.again(turn).x;
let texts = "";
for (let turn = 0; turn < 300; turn++) texts = first.again(turn % 2 ? "text" : { a: 1 }).x;
console.log(sum, typeof texts, first.again("text").x + first.again({ a: 1 }).x.a);
