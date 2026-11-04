// Under `bun <file>` a name of a module's top level that is read behind an `await` lies in the module's environment from that `await` on, though no function names it. A FinalizationRegistry in it calls back for as long as the module lives.
// Todo: Only `end` is printed: the executable keeps such a name in the frame of the module's body, and the frame goes when the body ends.
const called = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const target = () => ({ payload: new Array(50).fill(0) });
const registry = new FinalizationRegistry(held => void called.push(held));
registry.register(target(), "registered in front of the await");
await sleep(1);
registry.register(target(), "registered behind the await");

let rounds = 0;
const timer = setInterval(() => {
  Bun.gc(true);
  if (called.length < 2 && ++rounds < 40) return;
  clearInterval(timer);
  console.log(called.sort().join("\n"));
  console.log("end");
}, 5);
