// node:os and node:tty and parts of process: the answers differ from machine to machine, so the program prints what kind of answer each function gives and relations between them.
import os from "node:os";
import tty from "node:tty";

console.log(["linux", "darwin", "win32", "freebsd", "android"].includes(os.platform()), os.platform() === process.platform, os.arch() === process.arch, ["LE", "BE"].includes(os.endianness()));
console.log(JSON.stringify(os.EOL) === (process.platform === "win32" ? '"\\r\\n"' : '"\\n"'), typeof os.hostname(), typeof os.release(), typeof os.version(), typeof os.type(), typeof os.machine());
console.log(os.cpus().length > 0, os.cpus().length === os.availableParallelism() || os.availableParallelism() > 0, Object.keys(os.cpus()[0]).sort().join(), Object.keys(os.cpus()[0].times).sort().join());
console.log(os.totalmem() > os.freemem(), os.freemem() > 0, os.uptime() > 0, os.loadavg().length, os.tmpdir().length > 0, os.homedir().length > 0);
const user = os.userInfo();
console.log(Object.keys(user).sort().join(), typeof user.username, user.homedir === os.homedir() || typeof user.homedir);
const interfaces = Object.values(os.networkInterfaces()).flat();
console.log(interfaces.length > 0, interfaces.every(entry => ["IPv4", "IPv6"].includes(entry.family)), interfaces.some(entry => entry.internal));
console.log(os.constants.signals.SIGINT, os.constants.signals.SIGKILL, os.constants.errno.ENOENT, typeof os.constants.priority.PRIORITY_LOW, os.devNull);
console.log(typeof os.getPriority(), os.setPriority.length >= 1);
console.log(tty.isatty(0), tty.isatty(1), tty.isatty(2), tty.isatty(99), tty.isatty(-1), typeof tty.ReadStream, typeof tty.WriteStream, process.stdout.isTTY, process.stdin.isTTY);
console.log(typeof process.pid, process.ppid > 0, typeof process.uptime(), process.hrtime().length, typeof process.hrtime.bigint(), Object.keys(process.memoryUsage()).sort().join(), Object.keys(process.cpuUsage()).join(), Object.keys(process.resourceUsage()).length > 5);
console.log(typeof process.cwd(), typeof process.umask(), typeof process.getuid?.(), process.title.length > 0, typeof process.version, typeof process.versions.bun, process.release.name);
