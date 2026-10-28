// Eleven Workers, each a VM with its own instance of the compiled program: eight run worker.ts to the end and are terminated afterwards, two are terminated in the middle of its module body, and one imports nothing and exits at once. This file is the only entry point of the build, so it is also the entry point of every Worker.
type StartedWorker = { worker: Worker; closed: Promise<number> };

function startWorker(...argv: string[]): StartedWorker {
  const worker = new Worker("./start.ts", { argv });
  const closed = new Promise<number>(resolve => {
    worker.addEventListener("close", (event: Event) => resolve((event as CloseEvent).code));
  });
  return { worker, closed };
}

function firstMessage({ worker, closed }: StartedWorker): Promise<string> {
  const message = new Promise<string>(resolve => {
    worker.onmessage = (event: MessageEvent) => resolve(event.data);
  });
  return Promise.race([message, closed.then(code => "closed with exit code " + code)]);
}

async function terminate(workers: StartedWorker[]): Promise<void> {
  for (const { worker } of workers) worker.terminate();
  await Promise.all(workers.map(({ closed }) => closed));
}

async function runMainThread(): Promise<void> {
  const finishing = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => startWorker("finish", String(seed)));
  const endless = [9, 10].map(seed => startWorker("endless", String(seed)));
  const idle = startWorker("idle");
  const checksums = Promise.all(finishing.map(firstMessage));

  console.log((await Promise.all(endless.map(firstMessage))).join(", "));
  await terminate(endless);
  console.log("terminated 2 Workers inside a module body");
  console.log("idle Worker: exit code " + (await idle.closed));

  console.log((await checksums).sort().join("\n"));
  await terminate(finishing);
  console.log("terminated 8 Workers");

  Bun.gc(true);
  await import("./worker.ts");
}

if (Bun.isMainThread) await runMainThread();
else if (process.argv[2] !== "idle") await import("./worker.ts");

export {};
