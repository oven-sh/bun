import type { Shape } from "./shapes";
import { log, name as nameOfFirst } from "./first";
import { Worker } from "node:worker_threads";
import { total } from "./third";

const late = () => import("./second");
const shape: Shape = { kind: "square", side: 2 };
log("main", nameOfFirst, total(shape.side), typeof late);
const worker = new Worker("./main.ts");
worker.on("message", async (lines: string[]) => {
  for (const line of lines) console.log(line);
  const second = await late();
  log("main", second.name, second.area(shape));
  for (const line of (await import("./first")).lines) console.log(line);
});
