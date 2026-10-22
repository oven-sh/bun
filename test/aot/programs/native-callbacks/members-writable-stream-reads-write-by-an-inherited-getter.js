// new WritableStream(..) reads write of what it is given; here the plain object above has a getter under that name.
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
    get write() {
      log.push("get write " + (this === holder));
      return function (chunk, controller) {
        log.push("write " + (this === holder) + " " + arguments.length);
        kept.push(chunk);
      };
    },
  },
};
try {
  const result = await new WritableStream(holder).getWriter().write(item);
  console.log(result, kept[0].double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
