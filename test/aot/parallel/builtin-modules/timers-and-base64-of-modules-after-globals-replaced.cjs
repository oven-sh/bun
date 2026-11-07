// node:timers, node:timers/promises and node:buffer are first loaded after the program put getters that throw in the place of the globals.
// Each module has the function that was on globalThis, and no getter runs.
const names = [
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "atob",
  "btoa",
];
const natives = Object.fromEntries(names.map(name => [name, globalThis[name]]));
let getters = 0;
for (const name of names) {
  Object.defineProperty(globalThis, name, {
    get() {
      getters++;
      throw new Error(name + " was read from globalThis");
    },
    configurable: true,
  });
}
const timers = require("node:timers");
const buffer = require("node:buffer");
const promises = require("node:timers/promises");
for (const name of names) {
  const exported = timers[name] ?? buffer[name];
  console.log(name, exported === natives[name] ? "is the function that was on globalThis" : typeof exported);
}
timers.unenroll(timers.setTimeout(() => console.log("a timer that unenroll() did not clear"), 1));
async function firstOfInterval() {
  for await (const value of promises.setInterval(1, "setInterval")) return value;
}
Promise.all([
  promises.setTimeout(1, "setTimeout"),
  promises.setImmediate("setImmediate"),
  firstOfInterval(),
  promises.scheduler.wait(1).then(() => "scheduler.wait"),
  promises.scheduler.yield().then(() => "scheduler.yield"),
  new Promise(resolve => timers.setTimeout(resolve, 1, "node:timers")),
]).then(settled => console.log(settled.join(", "), "| getters that ran:", getters));
