// A control: native code sends no event of this kind to the global object, and the program sends none at all.
// STATISTIC: FunctionsLowered <= 1000
class Shelf {
  listen = () => {
    addEventListener("fetch", event => {
      event.respondWith(this.count(), event);
    });
  };
  count() {
    return 1;
  }
}
const shelf = new Shelf();
console.log(shelf.count(), typeof shelf.listen);
