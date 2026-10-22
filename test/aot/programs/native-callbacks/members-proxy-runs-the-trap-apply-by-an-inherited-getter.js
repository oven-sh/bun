// A proxy reads apply of its handler; here the plain object above has a getter under that name.
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
function target() {}
const holder = {
  __proto__: {
    get apply() {
      log.push("get apply " + (this === holder));
      return function (target, receiver, list) {
        log.push("apply " + (this === holder) + " " + arguments.length);
        return list[0];
      };
    },
  },
};
try {
  const result = new Proxy(target, holder)(item);
  console.log(result.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
