// EventTarget.prototype.dispatchEvent, for a listener that is an object, reads handleEvent of what it is given; here it is the object's own.
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const log = [];
const kept = [];
const item = new Item(1.5);
const holder = {
  handleEvent(event) {
    log.push("handleEvent " + (this === holder) + " " + event.type);
    kept.push(event.detail);
  },
};
try {
  const result = (target => (target.addEventListener("ping", holder), target.dispatchEvent(new CustomEvent("ping", { detail: item }))))(new EventTarget());
  console.log(result, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
