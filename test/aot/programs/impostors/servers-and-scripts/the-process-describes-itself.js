import os from "node:os";
import process2 from "node:process";

console.log(process === process2, typeof process.pid, typeof process.ppid, process.platform === os.platform(), process.arch === os.arch(), process.title.length > 0);
console.log(Array.isArray(process.argv), process.argv.length >= 1, typeof process.argv0, Array.isArray(process.execArgv), typeof process.execPath, typeof process.cwd());
console.log(typeof process.version, /^v\d+\.\d+\.\d+/.test(process.version), typeof process.versions.bun, typeof process.versions.node, typeof process.release.name, process.isBun);
process.env.MY_SETTING = 5;
console.log(process.env.MY_SETTING, typeof process.env.MY_SETTING, "MY_SETTING" in process.env, delete process.env.MY_SETTING, process.env.MY_SETTING, Object.keys(process.env).includes("PATH"));
const usage = process.memoryUsage();
console.log(Object.keys(usage).sort().join(), usage.rss > 0, process.memoryUsage.rss() > 0, Object.keys(process.cpuUsage()).join(), Object.keys(process.resourceUsage()).length > 5);
const [seconds, nanoseconds] = process.hrtime();
console.log(seconds >= 0, nanoseconds < 1e9, process.hrtime([seconds, nanoseconds]).length, process.hrtime.bigint() > 0n, process.uptime() < 60);
console.log(process.stdout.write("written to stdout\n"), process.stdout.isTTY, process.stdout.fd, process.stderr.fd, typeof process.stdout.columns, process.stdout.writable);
console.log(typeof process.umask(), typeof process.getuid?.(), typeof process.geteuid?.(), process.exitCode, typeof process.emitWarning, typeof process.binding, process.config.variables !== undefined, process.features.typescript !== null);
console.log(os.EOL === "\n", os.cpus().length > 0, typeof os.cpus()[0].model, os.totalmem() > os.freemem(), os.homedir().length > 0, os.tmpdir().length > 0, os.hostname().length > 0, os.type(), os.endianness(), os.loadavg().length);
console.log(typeof os.release(), typeof os.uptime(), Object.keys(os.userInfo()).sort().join(), typeof os.networkInterfaces(), os.constants.signals.SIGTERM, os.availableParallelism() > 0, os.devNull, typeof os.version(), typeof os.machine());
try {
  process.chdir("/no/such/folder");
} catch (error) {
  console.log(error.code, error.syscall);
}
try {
  process.kill(process.pid, "SIGNOPE");
} catch (error) {
  console.log(error.name, error.code);
}
console.log(process.kill(process.pid, 0), process.emit("custom", 1), process.listenerCount("custom"), process.getMaxListeners());
process.exitCode = 0;
process.nextTick((a, b) => console.log("tick", a, b), "one", "two");
