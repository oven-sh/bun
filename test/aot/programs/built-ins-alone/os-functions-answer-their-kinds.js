import os from "node:os";
const cpus = os.cpus();
console.log(Array.isArray(cpus), typeof cpus[0].model, typeof cpus[0].speed, typeof cpus[0].times.user, typeof os.freemem(), typeof os.totalmem(), typeof os.homedir(), typeof os.hostname());
console.log(os.loadavg().length, typeof os.loadavg()[0], typeof os.release(), typeof os.uptime(), typeof os.version(), typeof os.getPriority(), typeof os.availableParallelism());
