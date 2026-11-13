// Child makes several write() calls back to back (no sleeps), then stays alive. Parent attaches 'data' 250 ms later and reports the chunk sizes it saw before 'end' or 400 ms.
const { spawn } = require("child_process");
const which = process.argv[2] || "sh";
const cmd = which === "sh"
  ? ["sh", ["-c", "echo aaaa; echo bbbb; echo cccc; echo dddd; sleep 0.6"]]
  : which === "bunfs"
    ? ["/tmp/rel/bun-arm", ["-e", `const fs=require("fs"); for (const s of ["aaaa\\n","bbbb\\n","cccc\\n","dddd\\n"]) fs.writeSync(1, s); setTimeout(()=>{}, 600);`]]
    : which === "console"
      ? ["/tmp/rel/bun-arm", ["-e", `console.log("aaaa"); console.log("bbbb"); console.log("cccc"); console.log("dddd"); setTimeout(()=>{}, 600);`]]
      : which === "nodeconsole"
        ? ["node", ["-e", `console.log("aaaa"); console.log("bbbb"); console.log("cccc"); console.log("dddd"); setTimeout(()=>{}, 600);`]]
        : ["python3", ["-u", "-c", "import sys,time\nfor s in ['aaaa','bbbb','cccc','dddd']:\n  print(s)\ntime.sleep(0.6)"]];
const c = spawn(cmd[0], cmd[1], { stdio: ["ignore", "pipe", "ignore"] });
const sizes = [];
setTimeout(() => {
  c.stdout.on("data", d => sizes.push(d.length));
  setTimeout(() => { console.log(sizes.join("+")); process.exit(0); }, 150);
}, 250);
