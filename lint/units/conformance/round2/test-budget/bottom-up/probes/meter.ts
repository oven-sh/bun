// Meters of the calling (main) thread and of the process: on-CPU time, run-queue wait, block-I/O wait, bytes read from storage.
import { readFileSync } from "node:fs";
export interface Sample { wall: number; cpuUser: number; cpuSys: number; onCpu: number; runq: number; blkio: number; readBytes: number; rchar: number; majflt: number }
const tick = 10; // ms per clock tick (CLK_TCK 100)
export function sample(): Sample {
  const c = process.cpuUsage();
  const [on, rq] = readFileSync("/proc/thread-self/schedstat", "latin1").trim().split(" ").map(Number);
  const stat = readFileSync("/proc/thread-self/stat", "latin1");
  const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  // after the command name: f[0] is field 3 (state); field k is f[k-3]
  const blkio = Number(f[42 - 3]) * tick;
  const majflt = Number(f[12 - 3]);
  const io = readFileSync("/proc/self/io", "latin1");
  const g = (k: string) => Number(new RegExp(`^${k}: (\\d+)`, "m").exec(io)![1]);
  return { wall: performance.now(), cpuUser: c.user / 1000, cpuSys: c.system / 1000, onCpu: on / 1e6, runq: rq / 1e6, blkio, readBytes: g("read_bytes"), rchar: g("rchar"), majflt };
}
export function delta(a: Sample, b: Sample) {
  const wall = b.wall - a.wall, on = b.onCpu - a.onCpu, rq = b.runq - a.runq;
  return {
    wall: Math.round(wall),
    procUser: Math.round(b.cpuUser - a.cpuUser),
    procSys: Math.round(b.cpuSys - a.cpuSys),
    mainOnCpu: Math.round(on),
    mainRunq: Math.round(rq),
    mainBlocked: Math.round(wall - on - rq),
    blkio: Math.round(b.blkio - a.blkio),
    readMB: +((b.readBytes - a.readBytes) / 1e6).toFixed(1),
    rcharMB: +((b.rchar - a.rchar) / 1e6).toFixed(1),
    majflt: b.majflt - a.majflt,
  };
}
export function fmt(label: string, d: ReturnType<typeof delta>) {
  return `${label.padEnd(34)} wall ${String(d.wall).padStart(6)}  main: cpu ${String(d.mainOnCpu).padStart(5)} runq ${String(d.mainRunq).padStart(6)} blocked ${String(d.mainBlocked).padStart(6)} (blkio ${String(d.blkio).padStart(5)})  process: user ${String(d.procUser).padStart(5)} sys ${String(d.procSys).padStart(5)}  disk ${d.readMB} MB, read() ${d.rcharMB} MB, majflt ${d.majflt}`;
}
