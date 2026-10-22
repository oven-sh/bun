class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const target = new EventTarget();
target.addEventListener("ready", event => console.log(event.detail.double()));
target.dispatchEvent(new CustomEvent("ready", { detail: new Item(1.5) }));
