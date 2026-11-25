class Order {
  constructor(total) {
    this.total = total;
    this.note = "none";
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
function report(row) {
  let line = "row " + row.total;
  if (typeof row !== "number") line += "/" + row.total;
  return line;
}
const rows = [new Order(1), new Refund(2), new Coupon(3), new Order(4), 9];
for (let i = 0; i < rows.length; i++) console.log(report(rows[i]));
