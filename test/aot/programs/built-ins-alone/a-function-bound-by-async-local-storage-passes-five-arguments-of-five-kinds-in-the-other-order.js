import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
  console.log(typeof fourth, fourth + 1);
  console.log(typeof third, third.length);
  console.log(typeof second, second.four);
  console.log(typeof first, first());
  console.log(arguments.length);
}
AsyncLocalStorage.bind(target)(() => "five", { four: 4 }, "three", 2.5, 1);
