// new Response(..) reads status of what it is given; here the object has a getter under that name.
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
  get status() {
    log.push("get status " + (this === holder));
    return 200 + item.double();
  },
};
try {
  const result = new Response("body", holder);
  console.log(result.status);
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
