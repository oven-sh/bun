import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
const numbers = [1, 2];
function target(holder) {
  holder.push("three");
}
new AsyncLocalStorage().exit(target, numbers);
console.log(numbers.length, typeof numbers[2], numbers[2].length);
