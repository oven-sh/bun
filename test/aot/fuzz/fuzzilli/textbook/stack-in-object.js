function stack() {
  return { items: [], size: 0 };
}
function pushed(held, one) {
  held.items[held.size] = one;
  held.size++;
  return held;
}
const held = pushed(pushed(stack(), "a"), "b");
console.log(held.size, held.items.join(), JSON.stringify(held));
