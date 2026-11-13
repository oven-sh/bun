const { spawn } = require("node:child_process");
const c = spawn("sleep", ["3"], { stdio: ["ignore", "pipe", "pipe"] });
const fs = require("fs");
setTimeout(() => {
  const fds = fs.readdirSync("/proc/self/fd").map(f => { try { return f + "->" + fs.readlinkSync("/proc/self/fd/" + f); } catch { return f; } });
  const threads = fs.readdirSync("/proc/self/task").map(t => fs.readFileSync(`/proc/self/task/${t}/comm`, "utf8").trim());
  console.log(JSON.stringify({ pidfd: fds.filter(f => /pidfd/.test(f)), waitpidThreads: threads.filter(t => /Waitpid/i.test(t)), nthreads: threads.length }));
  c.kill();
}, 200);
