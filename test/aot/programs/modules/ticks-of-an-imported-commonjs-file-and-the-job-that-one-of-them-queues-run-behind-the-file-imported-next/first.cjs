console.log("first runs");
process.nextTick(() => {
  console.log("tick of first");
  process.nextTick(() => console.log("tick of the tick"));
  Promise.resolve().then(() => console.log("job of the tick"));
});
