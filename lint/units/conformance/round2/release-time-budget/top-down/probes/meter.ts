// Meters of one thread of this process: wall, user, system, time on a CPU, time runnable but waiting for a CPU, bytes fetched from storage, block I/O delay.
import { readFileSync } from "node:fs";
export interface Reading { wall: number; user: number; sys: number; run: number; wait: number; slices: number; readBytes: number; blkio: number; vol: number; invol: number; majflt: number; minflt: number }
export function read(): Reading {
  const cpu = process.cpuUsage();
  const [run, wait, slices] = readFileSync("/proc/self/schedstat", "utf8").trim().split(" ").map(Number);
  const io = readFileSync("/proc/self/io", "utf8");
  const readBytes = Number(/^read_bytes: (\d+)/m.exec(io)![1]);
  const stat = readFileSync("/proc/self/stat", "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const blkio = Number(fields[39]) * 10; // delayacct_blkio_ticks, field 42, ticks of 10 ms
  const minflt = Number(fields[7]);
  const majflt = Number(fields[9]);
  const status = readFileSync("/proc/self/status", "utf8");
  const vol = Number(/^voluntary_ctxt_switches:\s+(\d+)/m.exec(status)![1]);
  const invol = Number(/^nonvoluntary_ctxt_switches:\s+(\d+)/m.exec(status)![1]);
  return { wall: performance.now(), user: cpu.user / 1000, sys: cpu.system / 1000, run: run / 1e6, wait: wait / 1e6, slices, readBytes, blkio, vol, invol, majflt, minflt };
}
export function delta(a: Reading, b: Reading): string {
  const d = (k: keyof Reading) => (b[k] - a[k]).toFixed(0);
  return `wall ${d("wall")} ms | process user ${d("user")} sys ${d("sys")} ms | main thread on-cpu ${d("run")} ms, runnable-waiting ${d("wait")} ms, slices ${d("slices")} | storage read ${d("readBytes")} B, blkio delay ${d("blkio")} ms | ctxsw vol ${d("vol")} invol ${d("invol")} | faults major ${d("majflt")} minor ${d("minflt")}`;
}
