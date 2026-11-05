import { Session } from "node:inspector";
class Mine extends Session {
  own() {}
}
const box = JSON.parse("{}");
box.it = new Mine();
for (let level = Object.getPrototypeOf(box.it); level !== Object.prototype; level = Object.getPrototypeOf(level)) {
  for (const key of Reflect.ownKeys(level)) {
    if (!["own", "connect", "connectToMainThread", "disconnect"].includes(key)) continue;
    try {
      box.it[key]();
      console.log(key, "ran");
    } catch (error) {
      console.log(key, error.name);
    }
  }
}
