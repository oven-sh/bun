// What the compiler expects at a site is shared by all threads; what the site learns belongs to one thread. The main thread and each Worker send layouts, structures, methods and callees of their own through the same functions, and each changes its own copy of a class.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

class Message {
  kind = "message";
  size = 1;
  render(): string {
    return this.kind + ":" + this.size;
  }
}
class Reordered {
  size = 2;
  kind = "reordered";
  render(): string {
    return "<" + this.kind + ":" + this.size + ">";
  }
}
class Wider {
  a = 0;
  b = 0;
  kind = "wider";
  c = 0;
  size = 3;
  render(): string {
    return "[" + this.kind + ":" + this.size + "]";
  }
}

function kindOf(message: Message): string {
  return message.kind;
}
function sizeOf(message: Message): number {
  return message.size;
}
function resize(message: Message, size: number): void {
  message.size = size;
}
function render(message: Message): string {
  return message.render();
}
function call(callee: () => string): string {
  return callee();
}

function impostor(order: string): Message {
  if (order === "reordered") return new Reordered();
  if (order === "wider") return new Wider();
  if (order === "parsed") return Object.assign(JSON.parse('{"p":0,"size":4,"q":0,"kind":"parsed"}'), { render: () => "parsed renders" });
  if (order === "parsed otherwise") return Object.assign(JSON.parse('{"kind":"parsed otherwise","size":5}'), { render: () => "parsed otherwise renders" });
  return new Message();
}

function facts(order: string): string {
  const parts: string[] = [];
  const mine = impostor(order);
  const honest = new Message();
  for (let round = 0; round < 3; round++) {
    parts.push(kindOf(mine), String(sizeOf(mine)), render(mine), kindOf(honest), String(sizeOf(honest)), render(honest), call(() => order + round), call(mine.render.bind(mine)));
    resize(mine, sizeOf(mine) + 10);
    resize(honest, sizeOf(honest) + 100);
    if (round === 1) Bun.gc(true);
  }
  return parts.join(" ") + " " + JSON.stringify(mine);
}

function ask(order: string): Promise<string> {
  return new Promise(resolve => {
    const worker = new Worker(new URL(import.meta.url), { workerData: order });
    worker.once("message", (answer: string) => {
      void worker.terminate().then(() => resolve(answer));
    });
  });
}

if (isMainThread) {
  console.log("main, reordered: " + facts("reordered"));
  console.log(await ask("wider"));
  console.log("main, reordered: " + facts("reordered"));
  console.log(await ask("parsed"));
  console.log("main, parsed otherwise: " + facts("parsed otherwise"));
  const together = await Promise.all([ask("reordered"), ask("wider"), ask("parsed"), ask("parsed otherwise"), ask("honest"), ask("replaces the method")]);
  for (const answer of together) console.log(answer);
  Message.prototype.render = () => "main's own render";
  console.log("main, after its own replacement: " + facts("honest"));
  console.log(await ask("honest"));
  console.log(await ask("replaces the method"));
  console.log("main, at last: " + facts("wider"));
} else {
  const order = String(workerData);
  const before = facts(order);
  if (order === "replaces the method") Message.prototype.render = () => "the worker's own render";
  parentPort?.postMessage("worker, " + order + ": " + before + " then " + facts(order));
}

export {};
