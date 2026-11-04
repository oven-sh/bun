// A module hands on every name of a CommonJS file, one of which is `then`: which names its namespace object has is known when that file has run.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a known import() goes on with (the value of the promise of an ImportModule)
async function deed() {
  const got = await import("./barrel.mjs");
  return typeof got + " " + String(got && got.name);
}
console.log(await deed());
for (let i = 0; i < 100; i++) {
  if ((await deed()) !== "object handed over by then") console.log("wrong at", i);
}
console.log(await deed());
