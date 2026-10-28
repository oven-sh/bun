function say(name, load) {
  let line;
  try {
    const loaded = load();
    line = Object.keys(loaded).join() + " " + loaded.a;
  } catch (error) {
    line = "throws " + error.name;
  }
  console.log(name, line);
}
Promise.resolve().then(() => console.log("reaction 1")).then(() => console.log("reaction 2"));
(async () => { await null; console.log("async function resumes"); })();
queueMicrotask(() => console.log("job"));
process.nextTick(() => console.log("tick"));
say("require", () => require("./imports-three.mjs"));
console.log("main ends");
