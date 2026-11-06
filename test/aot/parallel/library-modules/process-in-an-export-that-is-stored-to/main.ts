// An exported binding that holds process and is stored to: another file reads members of process through it, and they are what they are in plain Bun: nothing behind them is left out.
import { late, out } from "./a";
console.log(typeof out.allowedNodeEnvironmentFlags.has, out.allowedNodeEnvironmentFlags.has("--no-such-flag"), typeof out.report, typeof out.memoryUsage.rss(), typeof out.hrtime.bigint(), typeof out.resourceUsage().maxRSS);
console.log(typeof late.allowedNodeEnvironmentFlags.has, typeof late.features.inspector, typeof late.release.name, typeof late.config.variables, typeof late.emitWarning, typeof late.cpuUsage().user);
