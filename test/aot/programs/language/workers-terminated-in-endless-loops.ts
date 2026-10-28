// A Worker that spins in `for (;;) {}` can be terminated: in a leaf function and in a function with a frame. The main thread goes on afterwards. This file is the only entry point of the build, so it is also the entry point of each Worker.
function sum(depth: number): number {
  return depth === 0 ? 0 : depth + sum(depth - 1);
}

function spinInLeaf(): never {
  for (;;) {}
}

function spinWithFrame(depth: number): never {
  postMessage("spinning after " + sum(depth));
  for (;;) {}
}

async function terminateWhileSpinning(kind: string): Promise<void> {
  const worker = new Worker("./workers-terminated-in-endless-loops.ts", { argv: [kind] });
  const closed = new Promise<void>(resolve => {
    worker.addEventListener("close", () => resolve());
  });
  const message = await new Promise<string>(resolve => {
    worker.onmessage = (event: MessageEvent) => resolve(event.data);
  });
  worker.terminate();
  await closed;
  console.log(kind + ": " + message + ", terminated");
}

if (Bun.isMainThread) {
  await terminateWhileSpinning("leaf");
  await terminateWhileSpinning("framed");
  console.log("the main thread computed " + sum(10));
} else if (process.argv[2] === "leaf") {
  postMessage("spinning");
  spinInLeaf();
} else {
  spinWithFrame(4);
}

export {};
