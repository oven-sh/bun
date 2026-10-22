let calls = 0;
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const item = new Item(1.5);
const first = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("[1.5]"));
    controller.close();
  },
});
class Special extends Array {
  count = 0;
  get statusText() {
    calls++;
    this.count++;
    console.log("statusText");
    return undefined;
  }
}
const special = new Special(1.5, item, "two");
console.log("made");
const result = new Response(first, special);
console.log(result instanceof Response, Object.keys(result).join(), Array.isArray(special), special.length);
console.log(typeof special[0], special[0] + 1, special[1].double());
console.log(typeof special[2], special[2].length, special[2], typeof special.count, special.count + 1);
console.log(calls, special.count);
