// Workers, ports and channels that no variable holds any more go on working while the main thread collects; listeners keep them. Heirs of Worker and of node's Worker work as their parents do.
import { Worker as NodeWorker, isMainThread, parentPort, workerData } from "node:worker_threads";

class Named extends Worker {
  label: string;
  constructor(label: string) {
    super(new URL(import.meta.url), { env: { MODE: "echo" } as any });
    this.label = label;
  }
  ask(value: number): Promise<string> {
    return new Promise(resolve => {
      this.addEventListener("message", event => resolve(this.label + " " + (event.target as Named).label + " " + (event.target === this) + " " + (event as MessageEvent).data), { once: true });
      this.postMessage(value);
    });
  }
}
class Pooled extends NodeWorker {
  jobs = 0;
  constructor() {
    super(new URL(import.meta.url), { workerData: "node echo" });
  }
  run(value: number): Promise<number> {
    this.jobs++;
    return new Promise(resolve => this.once("message", resolve).postMessage(value));
  }
}

if (isMainThread) {
  let heard = 0;
  const all: Promise<void>[] = [];
  for (let i = 0; i < 8; i++) {
    all.push(new Promise<void>(resolve => {
      new Worker(new URL(import.meta.url), { env: { MODE: "late" } as any }).onmessage = event => {
        heard += event.data;
        (event.target as Worker).terminate();
        resolve();
      };
    }));
  }
  for (let round = 0; round < 10; round++) {
    Bun.gc(true);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await Promise.all(all);
  console.log("heard from Workers nobody holds:", heard);

  let overPorts = 0;
  const ports: Promise<void>[] = [];
  for (let i = 0; i < 20; i++) {
    ports.push(new Promise<void>(resolve => {
      const { port1, port2 } = new MessageChannel();
      port2.onmessage = event => {
        overPorts += event.data;
        (event.target as MessagePort).close();
        resolve();
      };
      setTimeout(() => (port1.postMessage(1), port1.close()), 20);
    }));
  }
  Bun.gc(true);
  await Promise.all(ports);
  console.log("over ports nobody holds:", overPorts);

  const named = new Named("named");
  console.log(await named.ask(20), named instanceof Worker, named instanceof EventTarget, Object.getPrototypeOf(named) === Named.prototype);
  named.terminate();
  const pooled = new Pooled();
  console.log(await pooled.run(1), await pooled.run(2), pooled.jobs, pooled instanceof NodeWorker, typeof pooled.listenerCount, pooled.listenerCount("message"));
  console.log("ends with", await pooled.terminate());
} else if (workerData === "node echo") {
  parentPort!.on("message", (value: number) => parentPort!.postMessage(value * 10));
} else if (process.env.MODE === "late") {
  setTimeout(() => postMessage(1), 30);
  setInterval(() => {}, 1000);
} else {
  addEventListener("message", (event: MessageEvent<number>) => postMessage(event.data + 1));
}
