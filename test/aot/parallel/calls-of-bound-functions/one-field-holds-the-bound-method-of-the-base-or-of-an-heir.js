class Emitter {
  constructor() {
    this.heard = [];
    this.onData = this.handle.bind(this);
    this.onMore = this.handle.bind(this, "more");
  }
  handle(first, second) {
    this.heard.push(String(first) + ":" + String(second));
    return this.heard.length;
  }
}
class Loud extends Emitter {
  handle(first, second) {
    return super.handle("loud " + first, second) * 2;
  }
}
function pump(emitter, turns) {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += emitter.onData(turn, turn + 1) + emitter.onMore(turn);
  return sum;
}
console.log(pump(new Emitter(), 500), pump(new Loud(), 500));
const emitter = new Emitter(), loud = new Loud();
console.log(pump(emitter, 3), emitter.heard.join(), pump(loud, 2), loud.heard.join());
loud.onData = emitter.onData;
console.log(pump(loud, 2), emitter.heard.length, loud.heard.length);
