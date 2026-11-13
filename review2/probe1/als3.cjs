const { AsyncLocalStorage } = require("node:async_hooks");
const { spawn } = require("node:child_process");
const fd = +process.argv[2] || 3;
const als = new AsyncLocalStorage();
process.on("uncaughtException", error => { console.log(error.message + " | reported in: " + als.getStore()); });
process.on("unhandledRejection", error => console.log("(rejection) " + error.message + " | reported in: " + als.getStore()));
let child;
als.run("the spawn", () => { child = spawn("sh", ["-c", `sleep 0.1; printf hi >&${fd}; sleep 0.1; printf there >&${fd}`], { stdio: ["ignore", "pipe", "pipe", "pipe"] }); });
als.run("the listener attach", () => {
  let n = 0;
  child.stdio[fd].on("data", () => { const s = als.getStore(); if (++n === 1) console.log("data 1 sees: " + s); else throw new Error("data 2 thrown in: " + s); });
});
// timers: where does a timer's throw get reported?
als.run("the timer", () => setTimeout(() => { throw new Error("timer thrown in: " + als.getStore()); }, 400));
