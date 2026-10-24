// node:child_process with programs every system has: spawn with pipes, stdin that is written to, an exit code, a signal, spawnSync, exec, execSync, execFile, an environment, a working directory, and a program that does not exist.
import { spawn, spawnSync, exec, execSync, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

function run(command, args, options, input) {
  return new Promise(resolve => {
    const child = spawn(command, args, options);
    let out = "", err = "";
    child.stdout?.on("data", part => (out += part));
    child.stderr?.on("data", part => (err += part));
    child.on("error", error => resolve("error " + error.code));
    child.on("close", (code, signal) => resolve(JSON.stringify([code, signal, out, err])));
    if (input !== undefined) child.stdin.end(input);
  });
}

console.log(await run("echo", ["hello", "world"]));
console.log(await run("cat", [], {}, "through stdin"));
console.log(await run("sh", ["-c", "echo out; echo err >&2; exit 3"]));
console.log(await run("sh", ["-c", "echo $GREETING; pwd"], { env: { GREETING: "hi", PATH: process.env.PATH }, cwd: "/" }));
console.log(await run("no-such-program-anywhere", []));
const sleeper = spawn("sleep", ["30"]);
console.log(typeof sleeper.pid, sleeper.kill("SIGTERM"), await new Promise(resolve => sleeper.on("exit", (code, signal) => resolve([code, signal].join()))), sleeper.killed);

const sync = spawnSync("sh", ["-c", "cat; exit 2"], { input: "sync input", encoding: "utf8" });
console.log(sync.status, sync.signal, sync.stdout, JSON.stringify(sync.stderr));
console.log(spawnSync("no-such-program-anywhere").error.code);
console.log(execSync("echo from execSync", { encoding: "utf8" }).trim(), execFileSync("echo", ["from execFileSync"]).toString().trim());
try {
  execSync("exit 4", { stdio: "pipe" });
} catch (error) {
  console.log(error.status);
}
console.log((await promisify(exec)("echo from exec")).stdout.trim(), (await promisify(execFile)("echo", ["from execFile"])).stdout.trim());
console.log(await promisify(exec)("exit 5").catch(error => error.code));
