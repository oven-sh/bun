// `Inner.prototype = literal` in code that the executable leaves out: the build stopped ("nothing defines ..").
import { Box, Cup, Tray, isShelf, makePlain } from "./shapes.mjs";
console.log(isShelf({}), makePlain(4).kind(), Object.keys(makePlain(4)).join());
const cup = new Cup(3), box = new Box(5), tray = new Tray(7);
console.log(typeof cup.fill, cup.v, Object.getPrototypeOf(cup) === Cup.prototype);
console.log(typeof box.open, box.v, Object.getPrototypeOf(box) === Box.prototype);
console.log(tray.carry(), tray instanceof Tray, Object.getOwnPropertyNames(tray).join());
