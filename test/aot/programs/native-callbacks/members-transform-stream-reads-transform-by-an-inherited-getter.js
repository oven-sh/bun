// new TransformStream(..) reads transform of what it is given; here the plain object above has a getter under that name.
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
    get transform() {
      log.push("get transform " + (this === holder));
      return function (chunk, controller) {
        log.push("transform " + (this === holder) + " " + arguments.length);
        controller.enqueue(chunk);
      };
    },
  },
};
try {
  const result = await (stream => (stream.writable.getWriter().write(item), stream.readable.getReader().read()))(new TransformStream(holder));
  console.log(result.done, result.value.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
