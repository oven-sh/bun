// new WritableStream(..) reads abort of what it is given; here the object inherits it from the plain object two above.
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
  __proto__: {
    __proto__: {
      abort(reason) {
        log.push("abort " + (this === holder) + " " + arguments.length);
        kept.push(reason);
      },
    },
  },
};
try {
  const result = await new WritableStream(holder).abort(item);
  console.log(result, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
