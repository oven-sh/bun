// Does internal read-ahead go through the user-visible Array.prototype.push?
const { spawn } = require("child_process");
const realPush = Array.prototype.push;
let seen = 0;
Array.prototype.push = function (...args) {
  if (args.length === 1 && Buffer.isBuffer(args[0]) && new Error().stack.includes("native-readable")) { seen++; return this.length; } // drop it
  return realPush.apply(this, args);
};
const c = spawn("sh", ["-c", "printf hello"], { stdio: ["ignore", "pipe", "ignore"] });
let got = "";
c.on("exit", () => { c.stdout.on("data", d => (got += d)); });
c.on("close", () => { Array.prototype.push = realPush; console.log(JSON.stringify({ internalPushesSeenByUserCode: seen, got })); });
