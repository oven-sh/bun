// Child processes are started and their output read.
import { exec, execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";

console.log(JSON.stringify(execFileSync("echo", ["from", "execFileSync"], { encoding: "utf8" })));
const sync = spawnSync("sh", ["-c", "echo out; echo err >&2; exit 3"]);
console.log(sync.status, sync.signal, sync.stdout.toString(), sync.stderr.toString());
try {
  execFileSync("sh", ["-c", "exit 2"], { stdio: "pipe" });
} catch (error) {
  console.log("failed with", error.status);
}
console.log(spawnSync("no-such-command-anywhere").error?.code);

const { stdout } = await promisify(execFile)("printf", ["%s-%s", "a", "b"]);
console.log(stdout);
await new Promise(resolve => exec("echo $GREETING", { env: { GREETING: "hello", PATH: process.env.PATH } }, (error, out, err) => resolve(console.log(error, JSON.stringify(out), JSON.stringify(err)))));

const child = spawn("cat", [], { stdio: ["pipe", "pipe", "inherit"] });
let text = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", piece => (text += piece));
child.stdin.write("through ");
child.stdin.end("cat");
const [code, signal] = await new Promise(resolve => child.on("close", (...all) => resolve(all)));
console.log(text, code, signal, typeof child.pid, child.exitCode);

const sleeper = spawn("sleep", ["10"]);
sleeper.kill("SIGTERM");
console.log(await new Promise(resolve => sleeper.on("exit", (exitCode, exitSignal) => resolve([exitCode, exitSignal]))), sleeper.killed);

const viaBun = Bun.spawn(["sh", "-c", "cat; exit 4"], { stdin: "pipe", stdout: "pipe" });
viaBun.stdin.write("bun spawn");
viaBun.stdin.end();
console.log(await new Response(viaBun.stdout).text(), await viaBun.exited, viaBun.exitCode);
console.log(Bun.spawnSync(["echo", "sync"]).stdout.toString().trim(), Bun.spawnSync(["false"]).success);
