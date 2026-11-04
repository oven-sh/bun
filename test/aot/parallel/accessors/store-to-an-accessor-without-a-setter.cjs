// A literal lays a getter alone in the place of a field. A store to it is refused in silence in sloppy code.
function make(count) {
  return {
    count,
    get total() {
      return this.count * 2;
    },
  };
}
function put(cart, v) {
  cart.total = v;
  return cart.total;
}
function deed(cart) {
  try {
    return String(put(cart, 9));
  } catch (e) {
    return e.name;
  }
}
console.log(deed(make(1)));
let last = "";
for (let i = 0; i < 300; i++) last = deed(make(i));
console.log(last);
