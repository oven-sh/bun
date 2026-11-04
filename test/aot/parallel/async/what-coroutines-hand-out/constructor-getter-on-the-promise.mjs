// The promise that a call of an async function answers with gets a getter `constructor`, which the wait runs, and which answers with another constructor the second time.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a call of load() goes on with (LinkedCoroutine::fulfilledWith, objectsStayAsMade)
const log = [];
async function load(name) {
  return { name };
}
async function plain(name) {
  return (await load(name)).name;
}
async function deed(name, constructor) {
  const promise = load(name);
  Object.defineProperty(promise, "constructor", {
    get() {
      log.push("constructor of " + name);
      return constructor;
    },
  });
  log.push("in front");
  const got = await promise;
  log.push("behind");
  return got.name;
}
console.log(await plain("cold"));
console.log(await deed("first", Promise));
console.log(await deed("second", function Other() {}));
console.log(log.join(", "));
for (let i = 0; i < 300; i++) {
  if ((await plain("x" + i)) !== "x" + i) console.log("plain is wrong at", i);
}
log.length = 0;
console.log(await deed("third", Promise), log.join(", "));
