// A Worker closes the numbers and starts a Worker.
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
function takeTheNumbersAgain() {
  const short = path.join(os.tmpdir(), "a-short-file-" + process.pid);
  fs.writeFileSync(short, "short");
  const taken = [];
  for (let i = 0; i < 4; i++) taken.push(fs.openSync(short, "r"));
  fs.unlinkSync(short);
  return taken;
}
function start(data) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: data });
    worker.on("message", (text) => { worker.terminate(); resolve(text); });
    worker.on("error", (error) => resolve("error " + error.name));
  });
}
if (isMainThread) {
  console.log("main", total(shapes));
  console.log("worker", await start(1));
} else if (workerData === 1) {
  closeWhatNamesTheExecutable();
  const taken = takeTheNumbersAgain();
  parentPort.postMessage(total(shapes) + " > " + await start(0));
} else parentPort.postMessage(total(shapes));
