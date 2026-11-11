// Functions that are called as written and also handed to the queue of microtasks, to a promise and to a timer.
const order: string[] = [];
function first(): void {
  order.push("first");
}
function second(value: number): number {
  order.push("second" + value);
  return value + 1;
}
function third(): void {
  order.push("third");
  console.log(order.join());
}
first();
second(0);
queueMicrotask(first);
Promise.resolve(1).then(second).then(second);
setTimeout(third, 1);
