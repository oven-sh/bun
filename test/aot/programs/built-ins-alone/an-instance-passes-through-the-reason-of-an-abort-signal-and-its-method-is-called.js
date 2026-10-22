class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const controller = new AbortController();
controller.abort(new Item(1.5));
console.log(controller.signal.reason.double(), AbortSignal.abort(new Item(2.5)).reason.double());
