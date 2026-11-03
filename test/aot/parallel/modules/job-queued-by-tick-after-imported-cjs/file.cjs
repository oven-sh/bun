let chain = Promise.resolve();
for (let job = 1; job <= 6; job++) chain = chain.then(() => console.log("job", job));
process.nextTick(() => console.log("tick"));
for (const name of ["./awaits-tick.mjs", "./awaits-thenable.mjs"]) {
  try {
    require(name);
  } catch (error) {
    console.log("caught", error.constructor.name);
  }
}
process.nextTick(() => queueMicrotask(() => console.log("job of the last tick")));
console.log("file ends");
