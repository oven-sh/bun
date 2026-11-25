// A literal lays a getter in the place of a field, so the slot holds the functions of the accessor. A spread, a rest and Object.assign take what the getter gives, and never what lies in the slot.
type Cart = { count: number; readonly total: number };
function make(count: number): Cart {
  return {
    count,
    get total() {
      return this.count * 2;
    },
  };
}
function deed(cart: Cart) {
  const { count, ...others } = cart;
  return JSON.stringify({ first: 0, ...cart }) + JSON.stringify(others) + JSON.stringify(Object.assign({ first: 0 }, cart)) + String(count);
}
console.log(deed(make(1)));
let last = "";
for (let i = 0; i < 300; i++) last = deed(make(i));
console.log(last);
