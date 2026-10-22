import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
function target(first, second, third, fourth = "default") {
  console.log(first + 1, second.length);
  console.log(third === undefined, typeof third, fourth.length);
  console.log(arguments.length);
}
new AsyncLocalStorage().exit(target, 1.5, "two");
