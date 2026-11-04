// The host hands a promise that was rejected with nobody waiting to the listeners of the process. The listener gives it a constructor and a `then` of its own.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a call of load() goes on with (LinkedCoroutine::fulfilledWith, objectsStayAsMade)
process.on("unhandledRejection", (reason, promise) => {
  console.log("listener", reason.message);
  promise.constructor = function Other() {};
  promise.then = function (resolve) {
    resolve(7);
  };
});
async function load(fails) {
  if (fails) throw new Error("no");
  return { name: "a" };
}
function nameOf(loaded) {
  return typeof loaded + " " + String(loaded.name);
}
async function main() {
  console.log(nameOf(await load(false)));
  const kept = load(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  console.log(nameOf(await kept));
}
main();
