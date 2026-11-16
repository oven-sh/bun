// Fields that hold whole numbers or null, in a list that loops read and write
class Slot {
  constructor(value) {
    this.value = value;
    this.owner = null;
  }
}
function fill(size, every) {
  const slots = [];
  for (let i = 0; i < size; i++) slots.push(new Slot(i % every === 0 ? null : i));
  let empty = 0, sum = 0;
  for (const slot of slots) {
    if (slot.value === null) {
      empty++;
      slot.owner = empty;
    } else sum += slot.value;
  }
  for (const slot of slots) if (slot.owner !== null) slot.value = slot.owner * 100;
  return empty + " " + sum + " " + slots.map(slot => slot.value + "/" + slot.owner).join();
}
console.log(fill(4, 2));
console.log(fill(5, 3));
console.log(fill(3, 1));
