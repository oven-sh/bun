// A child is handed the variables of the environment and one more. Listing the environment compiles nothing else of the library.
// STATISTIC: ImageFunctionsEmitted <= 20
Bun.spawn([process.execPath, "--version"], { stdout: "ignore", env: { ...process.env, BUN_BE_BUN: "1" } });
console.log("started");
