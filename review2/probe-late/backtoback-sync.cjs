// Same children as backtoback.cjs, but the 'data' listener is attached right after spawn(): the baseline where main is already per-read.
const { spawn } = require("child_process");
const which = process.argv[2] || "sh";
const cmd = which === "console"
  ? ["/tmp/rel/bun-arm", ["-e", `console.log("aaaa"); console.log("bbbb"); console.log("cccc"); console.log("dddd"); setTimeout(()=>{}, 300);`]]
  : ["node", ["-e", `console.log("aaaa"); console.log("bbbb"); console.log("cccc"); console.log("dddd"); setTimeout(()=>{}, 300);`]];
const c = spawn(cmd[0], cmd[1], { stdio: ["ignore", "pipe", "ignore"] });
const sizes = [];
c.stdout.on("data", d => sizes.push(d.length));
c.on("close", () => { console.log(sizes.join("+")); });
