// The promise that a call of an async function answers with is moved below another object in front of the wait.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a call of load() goes on with (LinkedCoroutine::fulfilledWith, objectsStayAsMade)
async function load(name) {
  return { name };
}
async function plain(name) {
  return (await load(name)).name;
}
const above = {
  then(resolve) {
    resolve("from above");
  },
};
async function deed(name) {
  const promise = load(name);
  Object.setPrototypeOf(promise, above);
  const got = await promise;
  return typeof got + " " + String(got);
}
console.log(await plain("cold"));
console.log(await deed("cold"));
for (let i = 0; i < 300; i++) {
  if ((await plain("x" + i)) !== "x" + i) console.log("plain is wrong at", i);
  if ((await deed("x" + i)) !== "string from above") console.log("the deed is wrong at", i);
}
console.log(await plain("behind"));
