class Item { constructor(value, next) { this.value = value; this.next = next; this.seen = 0; } }
function total(first) { let sum = 0, steps = 0; let at = first; while (at != null) { sum += at.value; at.seen++; steps++; at = at.next; } return sum * 100 + steps; }
let list = null; for (let i = 0; i < 25; i++) list = new Item(i, list);
const byName = { total }, key = JSON.parse('"total"');
let all = 0; for (let k = 0; k < 3000; k++) all = (all + byName[key](list)) % 1000003;
console.log(all, list.seen, list.next.seen);
