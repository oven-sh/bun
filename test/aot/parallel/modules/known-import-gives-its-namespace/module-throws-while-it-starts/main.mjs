// A module that throws while it starts is imported by import(), twice: the promise is rejected with what was thrown, and nothing goes on behind the wait.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a known import() goes on with, and what the handler catches
async function deed() {
  try {
    const library = await import("./library.mjs");
    return "loaded " + typeof library.never;
  } catch (error) {
    return "caught " + typeof error + " " + String(error && error.reason);
  }
}
console.log(await deed());
console.log(await deed());
for (let i = 0; i < 100; i++) {
  if ((await deed()) !== "caught object thrown at the start") console.log("wrong at", i);
}
