let sum = 0;
class Order { constructor(v) { this.total = v; this.note = 1; } }
class Refund { constructor(v) { this.amount = v; } }
class Coupon { constructor(v) { this.code = v; } }
function show(item) { let out = "" + item.total; if (typeof item !== "number" && item.total) sum += item.total; return out; }
const edited = new Order(7);
delete edited.note;
const rows = [new Order(2), new Refund(3), new Coupon(4), edited, 9];
for (let i = 0; i < rows.length; i++) show(rows[i]);
console.log(sum);
