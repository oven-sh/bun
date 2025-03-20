async function spawn() {
  // mimicking a small subprocess with minimal stdout output (not actual process i'm spawning)
  const proc = Bun.spawn(["sed", "20q", "/etc/passwd"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  // In my app, I'm consuming the stdout stream output but I didn't do it in this test
  // to rule that out so I'm just waiting for the process to exit
  // const output = await Bun.readableStreamToText(proc.stdout);
  await proc.exited;
}

async function main() {
  let warmup = 2000;
  let iters = 25000;
  const batches = 5;
  const snap = false;

  async function after(name: string) {
    Bun.gc(true);
    if (snap) await Bun.write(`tmp/spawn-leak.${name}.heapsnapshot`, Bun.generateHeapSnapshot("v8"));
  }

  console.log(`Warming up...`);
  for (let i = 0; i < warmup; i++) {
    await spawn();
  }
  await after("warmup");

  for (let batch = 0; batch < batches; batch++) {
    console.log(`Running batch #${batch}...`);
    for (let i = 0; i < iters; i++) {
      await spawn();
    }
    await after(`batch-${batch}`);
  }
}

// main();

// await spawn();
// Bun.gc(true);

const proc = Bun.spawnSync(["sed", "20q", "/etc/passwd"], {
  stdio: ["ignore", "pipe", "pipe"],
});

console.log(proc.stdout.toString())
