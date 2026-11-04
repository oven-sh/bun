// The promise that a call of an async function answers with gets a `then` of its own in front of the wait.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a call of load() goes on with (LinkedCoroutine::fulfilledWith, objectsStayAsMade)
async function load(name) {
  return { name, kind: "loaded" };
}
async function plain(name) {
  const user = await load(name);
  return user.name + " " + user.kind;
}
async function deed(name) {
  const promise = load(name);
  promise.then = function (resolve) {
    resolve(41);
  };
  const got = await promise;
  return typeof got + " " + String(got);
}
async function through(promise) {
  const got = await promise;
  return typeof got;
}
console.log(await plain("cold"));
console.log(await deed("cold"));
for (let i = 0; i < 300; i++) {
  if ((await plain("x" + i)) !== "x" + i + " loaded") console.log("plain is wrong at", i);
  if ((await deed("x" + i)) !== "object [object Object]") console.log("the deed is wrong at", i);
}
const marked = load("marked");
marked.then = function (resolve) {
  resolve("own");
};
console.log(await through(load("as made")), await through(marked));
console.log(await plain("behind"));
