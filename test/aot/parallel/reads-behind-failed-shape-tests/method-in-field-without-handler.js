class Order { constructor(v) { this.total = v; this.run = () => "ran"; this.note = 1; } }
class Refund { constructor(v) { this.amount = v; } }
class Coupon { constructor(v) { this.code = v; } }
function show(item) {
  let out = "" + typeof item.run;
  if (typeof item !== "number" && item instanceof Order) out += "/" + item.run();
  return out;
}
const edited = new Order(7);
delete edited.note;
const rows = [new Order(2), new Refund(3), new Coupon(4), edited, 9];
for (let i = 0; i < rows.length; i++) console.log(show(rows[i]));
