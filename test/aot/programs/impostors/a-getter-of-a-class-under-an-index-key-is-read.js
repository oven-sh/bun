class Shelf {
  get 10() {
    return 42;
  }
}
const shelf = new Shelf();
console.log(shelf[10]);
