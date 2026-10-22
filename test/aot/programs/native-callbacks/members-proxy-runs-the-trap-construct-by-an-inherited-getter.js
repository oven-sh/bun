// A proxy reads construct of its handler; here the plain object above has a getter under that name.
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
    get construct() {
      log.push("get construct " + (this === holder));
      return function (target, list, newTarget) {
        log.push("construct " + (this === holder) + " " + arguments.length);
        return { held: list[0] };
      };
    },
  },
};
try {
  const result = new (new Proxy(target, holder))(item);
  console.log(result.held.double());
} catch (error) {
  console.log("threw " + error.constructor.name + ": " + error.message);
}
console.log(log.join("\n"));
