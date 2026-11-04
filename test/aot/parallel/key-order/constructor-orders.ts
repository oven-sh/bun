// A constructor creates its fields in one of two orders.
class Pair {
  declare left: number;
  declare right: number;
  constructor(swapped: boolean) {
    if (swapped) {
      this.right = 1;
      this.left = 2;
    } else {
      this.left = 1;
      this.right = 2;
    }
  }
}
console.log(Object.keys(new Pair(false)).join(), Object.keys(new Pair(true)).join());
