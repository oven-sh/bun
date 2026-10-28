// The function is only a parent: nothing constructs it. The first store through super comes before its prototype object gets the setter, the second after, the third after the class got another parent.
const log = [];
function Above() {}
Above.prototype = { constructor: Above };
class Below extends Above {
  put(value) {
    super.held = value;
  }
}
const first = new Below();
first.put(1);
console.log(Object.keys(first).join(), log.join());
Object.defineProperty(Above.prototype, "held", {
  set(value) {
    log.push(value);
  },
  configurable: true,
});
const second = new Below();
second.put(2);
console.log(Object.keys(second).join(), log.join());
Object.setPrototypeOf(Below.prototype, {
  set held(value) {
    log.push("other " + value);
  },
});
const third = new Below();
third.put(3);
console.log(Object.keys(third).join(), log.join());
