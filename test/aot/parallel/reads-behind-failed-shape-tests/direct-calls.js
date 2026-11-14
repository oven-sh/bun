class Order { constructor() { this.total = 7; this.note = 1; } }
class Refund { constructor() { this.amount = 3; } }
class Coupon { constructor() { this.code = 4; } }
function show(item) { let out = "" + item.total; if (typeof item !== "number") out += "/" + item.total; return out; }
const edited = new Order(); delete edited.note;
show(new Refund()); show(new Coupon()); show(9);
console.log(show(edited));
