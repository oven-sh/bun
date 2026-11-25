class Order {
  constructor(total) {
    this.total = total;
    this.run = () => "ran " + total;
    this.note = 1;
  }
  shout() {
    return "order " + this.total;
  }
}
class Refund {
  constructor(amount) {
    this.amount = amount;
  }
}
class Coupon {
  constructor(code) {
    this.code = code;
  }
}
function show(item) {
  let out = "" + item.total;
  if (typeof item !== "number") out += "/" + item.total;
  return out;
}
const edited = new Order(7);
delete edited.note;
const rows = [new Order(2), new Refund(3), new Coupon(4), edited, 9];
for (const row of rows) console.log(show(row));
