export const limit = 8;
export default class Queue {
  items = [];
  push(one) {
    this.items.push(one);
  }
  get size() {
    return this.items.length;
  }
}
export function isQueue(one) {
  return one instanceof Queue;
}
