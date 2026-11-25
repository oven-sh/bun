// What the file gives is a class: it is made and extended through the name.
import EventEmitter from "node:events";
class Mine extends EventEmitter {
  hi() {
    return this.emit("x", 4);
  }
}
const mine = new Mine();
let got = 0;
mine.on("x", value => {
  got = value;
});
console.log(mine.hi(), got, new EventEmitter().listenerCount("x"), mine instanceof EventEmitter, EventEmitter.EventEmitter === EventEmitter);
