class Shelf {
  set 10(value) {
    this.stored = value;
  }
}
const shelf = new Shelf();
shelf[10] = 42;
console.log(shelf.stored);
