import { heapStats, memoryUsage } from "bun:jsc";
import "./server.ts";

process.on("SIGUSR2", () => {
  const before = heapStats();
  Bun.gc(true);
  Bun.gc(true);
  const after = heapStats();
  void Bun.write(process.env.MEMORY_REPORT ?? "/dev/null", JSON.stringify({ before, after, memoryUsage: memoryUsage(), process: process.memoryUsage() }));
});
