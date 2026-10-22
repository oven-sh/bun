import { EventEmitter } from "node:events";
class Door extends EventEmitter {
  opened = 0;
  open(by) {
    this.emit("open", by);
  }
}
const door = new Door();
door.on("open", function (by) {
  this.opened = by;
});
door.open("hand");
console.log(typeof door.opened, door.opened.length);
