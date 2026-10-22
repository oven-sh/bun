import { Bag } from "./bag.js";
export function run() {
  Bag.prototype[Symbol.iterator] = function* () { for (const x of this.items) yield "late" + x; };
  Bag.prototype.valueOf = function () { return 41; };
}
