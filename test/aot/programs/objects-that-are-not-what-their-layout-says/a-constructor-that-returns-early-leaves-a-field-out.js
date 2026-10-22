function Item(name, bare) {
  this.name = name;
  if (bare) return;
  this.next = null;
}
function read(item) {
  return item.name + ":" + String(item.next) + ":" + ("next" in item);
}
const whole = new Item("whole", false), bare = new Item("bare", true);
console.log(read(whole), read(bare));
bare.next = whole;
whole.next = bare;
console.log(read(whole).replace("[object Object]", "bare"), read(bare).replace("[object Object]", "whole"), Object.keys(bare).join());
