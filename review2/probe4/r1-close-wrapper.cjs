// Port of "does not reach 'close', where a program would exit with the child's code" (child_process.test.ts) to the fd route.
const { spawnFd } = require("./fdroute.cjs");
const opts = Object.assign(JSON.parse(process.argv[2] || "{}"), { extra: 1 });
const c = spawnFd("sh", ["-c", "(read line <&5; printf hi) & exit 0"], opts);
c.extra[0].on("error", () => {});
c.stdout.on("data", () => { console.log("data"); throw new Error("data-throw-fatal"); });
c.stdout.on("end", () => console.log("end"));
c.on("exit", () => { console.log("exit"); c.extra[0].end("\n"); });
c.on("close", code => { console.log("close"); process.exit(code); });
