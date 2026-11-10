import { EventEmitter } from "node:events";
const kept = EventEmitter.prototype;
const log: string[] = [];
const table: Record<string, any> = {};
table[process.argv.length > 99 ? "x" : "made"] = EventEmitter;
let laid = "laid";
try { (EventEmitter as any).prototype = Object.create(kept, { tag: { value: "replaced" } }); } catch (error) { laid = (error as Error).constructor.name; }
log.push(laid);
const first = Number(process.argv[2] ?? 3);
for (let turn = first; turn < first + 3; turn++) {
  const made = new table.made();
  log.push([made.tag, made instanceof EventEmitter, Object.getPrototypeOf(made) === kept, typeof made.on, made.listenerCount("x")].join(" "));
  if (turn === first + 1) { try { (EventEmitter as any).prototype = kept; log.push("back"); } catch (error) { log.push((error as Error).constructor.name); } }
}
console.log(log.join("\n"));
