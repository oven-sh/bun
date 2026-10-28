// A child has a channel where the options of Bun.spawn have `ipc`. These have none: nothing of what the channel needs is compiled.
// STATISTIC: ImageFunctionsEmitted <= 20
Bun.spawn([process.execPath, "--version"], { stdout: "ignore", env: { ...process.env, BUN_BE_BUN: "1" } });
Bun.spawn({ cmd: [process.execPath, "--version"], stdout: "ignore", env: { ...process.env, BUN_BE_BUN: "1" } });
console.log("started");
