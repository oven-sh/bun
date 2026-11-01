// Entry points: ./lib/other.ts
if (Bun.isMainThread) {
  const start = (name: string) =>
    new Promise<string>(resolve => {
      let worker: Worker;
      try {
        worker = new Worker(name);
      } catch (error) {
        return resolve(name + " THROWS " + (error as Error).name);
      }
      worker.onmessage = event => {
        resolve(name + " " + event.data);
        worker.terminate();
      };
      worker.addEventListener("close", (event: any) => resolve(name + " closed " + event.code));
      worker.addEventListener("error", (event: any) => {
        event.preventDefault?.();
      });
    });
  for (const name of [
    "./main.ts",
    "./main",
    "./main.js",
    "./lib/../main.ts",
    "./lib/other.ts",
    "./lib/other",
    "./lib/other.js",
    "./nope.ts",
  ])
    console.log(await start(name));
} else postMessage("started");
