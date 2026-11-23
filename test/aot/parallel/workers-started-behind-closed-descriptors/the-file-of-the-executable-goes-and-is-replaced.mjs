// The file of the executable goes from the disk, and another file takes its name, while the program runs: a copy of the program does that to itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
class Shape { constructor(side) { this.side = side; } area() { return 0; } name() { return "shape"; } }
class Square extends Shape { area() { return this.side * this.side; } name() { return "square"; } }
class Line extends Shape { name() { return "line"; } }
class Cube extends Shape { area() { return 6 * this.side * this.side; } }
function total(shapes) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = 0; let names = "";
  for (let i = 0; i < 300; i++) { const shape = shapes[i % shapes.length]; sum += shape.area(); if (i < 4) names += shape.name() + " "; }
  return names + sum;
}
const shapes = [new Square(2), new Line(3), new Cube(1), new Shape(9)];
function closeWhatNamesTheExecutable() {
  try {
    const own = fs.readlinkSync("/proc/self/exe");
    for (const name of fs.readdirSync("/proc/self/fd")) {
      let target = "";
      try { target = fs.readlinkSync("/proc/self/fd/" + name); } catch {}
      if (target === own) fs.closeSync(Number(name));
    }
  } catch {}
}
function start(data) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: data });
    worker.on("message", (text) => { worker.terminate(); resolve(text); });
    worker.on("error", (error) => resolve("error " + error.name));
  });
}
import { spawnSync } from "node:child_process";
if (process.platform === "win32") console.log("the file of a program that runs cannot go here");
else if (isMainThread && !process.env.RUNS_AS_THE_COPY) {
  const copy = path.join(os.tmpdir(), "copy-of-the-program-" + process.pid);
  fs.copyFileSync(process.execPath, copy);
  fs.chmodSync(copy, 0o755);
  const argv = process.argv[1] && fs.existsSync(process.argv[1]) && process.argv[1] !== process.execPath ? [process.argv[1]] : [];
  const ran = spawnSync(copy, argv, { env: { ...process.env, RUNS_AS_THE_COPY: copy }, encoding: "utf8" });
  console.log(ran.stdout.trim(), "| exit", ran.status, ran.signal);
  try { fs.unlinkSync(copy); } catch {}
} else if (isMainThread) {
  console.log("main", total(shapes));
  fs.unlinkSync(process.env.RUNS_AS_THE_COPY);
  console.log("gone", await start(0));
  fs.writeFileSync(process.env.RUNS_AS_THE_COPY, "another file under that name");
  console.log("replaced", await start(0));
} else parentPort.postMessage(total(shapes));
