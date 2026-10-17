import { Core } from "./core.ts";
export class Heir extends Core {
  then(resolve) {
    resolve("a string");
  }
}
export class HeirThatYieldsACore extends Core {
  then(resolve) {
    resolve(new Core());
  }
}
export class HeirThatRejects extends Core {
  then(resolve, reject) {
    reject(new RangeError("rejected"));
  }
}
export function addThen(object) {
  object.then = resolve => resolve("an own then");
  return object;
}
