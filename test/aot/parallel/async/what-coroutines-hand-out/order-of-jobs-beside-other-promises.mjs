// Waits on calls of async functions that return a primitive, a promise and a thenable run beside other jobs: the order of all of them is printed.
// Under: --aot-testing=CheckProofsAtRunTime: what each wait goes on with (LinkedCoroutine::fulfilledWith)
const log = [];
async function primitive() {
  return 1;
}
async function promise() {
  return Promise.resolve(2);
}
async function thenable() {
  return {
    then(resolve) {
      log.push("then is called");
      resolve(3);
    },
  };
}
async function waitsFor(name, make) {
  log.push(name + " begins");
  const got = await make();
  log.push(name + " got " + got);
}
function deed() {
  const all = [waitsFor("primitive", primitive), waitsFor("promise", promise), waitsFor("thenable", thenable)];
  let turn = Promise.resolve();
  for (let i = 0; i < 6; i++) turn = turn.then(() => log.push("turn " + i));
  all.push(turn);
  return Promise.all(all);
}
await deed();
console.log(log.join("\n"));
const first = log.join();
for (let i = 0; i < 100; i++) {
  log.length = 0;
  await deed();
  if (log.join() !== first) console.log("another order at", i);
}
