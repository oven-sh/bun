// Same CLI, written with events.once(): wait for 'finish', treat EPIPE as a normal end.
import { once } from "node:events";
const report = ("line ".repeat(19) + "\n").repeat(40000);
process.stdout.write(report);
process.stdout.end();
try { await once(process.stdout, "finish"); } catch (e) { if (e.code !== "EPIPE") throw e; }
