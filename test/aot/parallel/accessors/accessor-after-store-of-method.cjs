// A method that the constructor calls stores the value; the accessor is defined after it, in the constructor and on one instance.
const log = [];
class Started {
  constructor() {
    this.a = 1;
    this.start();
    Object.defineProperty(this, "b", { configurable: true, enumerable: true, get() { log.push("get"); return 4; }, set(value) { log.push("set " + value); } });
  }
  start() {
    this.b = 7;
  }
}
class Plain {
  constructor() {
    this.a = 1;
    this.start();
  }
  start() {
    this.b = 7;
  }
}
const started = new Started();
console.log(started.b, Object.keys(started).join(), log.splice(0).join());
const plain = new Plain();
Object.defineProperty(plain, "b", { configurable: true, enumerable: true, get() { log.push("get"); return 5; }, set(value) { log.push("set " + value); } });
console.log(plain.b, new Plain().b, Object.keys(new Plain()).join(), log.splice(0).join());
