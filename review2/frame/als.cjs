const { AsyncLocalStorage } = require("node:async_hooks");
const { spawn } = require("node:child_process");
const als = new AsyncLocalStorage();
process.on("uncaughtException", error => console.log(error.message + ", reported in " + als.getStore()));
process.on("unhandledRejection", error => console.log("(rejection) " + error.message + ", reported in " + als.getStore()));
let child;
als.run("the spawn", () => { child = spawn("sh", ["-c", "sleep 0.1; printf hi; sleep 0.1; printf there"], { stdio: ["ignore", "pipe", "pipe"] }); });
als.run("the listener attach", () => {
  let n = 0;
  child.stdout.on("data", () => { const s = als.getStore(); if (++n === 1) console.log("data 1 sees " + s); else throw new Error("data 2 thrown in " + s); });
});
