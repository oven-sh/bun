// A module that exports a function `then` is imported by import(): the promise is resolved through that function and not with the namespace object.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a known import() goes on with (the value of the promise of an ImportModule)
async function deed() {
  const got = await import("./library.mjs");
  return typeof got + " " + String(got && got.name);
}
console.log(await deed());
for (let i = 0; i < 100; i++) {
  if ((await deed()) !== "object handed over by then") console.log("wrong at", i);
}
console.log(await deed());
