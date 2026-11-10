let settle;
const gate = new Promise(resolve => {
  settle = resolve;
});
queueMicrotask(settle);
await gate;
console.log("settled-by-a-job ran");
export const name = "settled-by-a-job";
