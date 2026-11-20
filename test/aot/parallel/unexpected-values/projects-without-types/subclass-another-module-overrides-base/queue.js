export class Queue {
  constructor() {
    this.items = [];
    this.limit = 3;
  }
  add(item) {
    if (this.size() >= this.limit) return "full";
    return this.items.push(item);
  }
  size() {
    return this.items.length;
  }
  first() {
    return this.items[0];
  }
  total() {
    let sum = 0;
    for (const item of this.items) sum += item;
    return sum;
  }
  room() {
    return this.limit - this.size();
  }
}
