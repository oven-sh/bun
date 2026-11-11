// A child is handed the variables of the environment and one more. Listing the environment compiles nothing else of the library.
// Where the child turns out to be this program again, the count that is handed on ends the chain at the second child.
// STATISTIC: ImageFunctionsEmitted <= 20 Todo on win32: the object is a proxy there, which windowsEnv() of the library makes with all its traps at the first use: names-and-variables-of-the-environment-listed.js counts 397 functions for it
const started = Number(process.env.STARTED_BY_THIS_PROGRAM || 0);
if (started < 2)
  Bun.spawn([process.execPath, "--version"], { stdout: "ignore", env: { ...process.env, BUN_BE_BUN: "1", STARTED_BY_THIS_PROGRAM: String(started + 1) } });
console.log("started");
