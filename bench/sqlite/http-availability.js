const pingCount = 100;
const serverPath = new URL("./http-availability-server.js", import.meta.url).pathname;

function percentile(sorted, value) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

async function run(mode) {
  await using proc = Bun.spawn({
    cmd: [process.execPath, serverPath, mode],
    stdout: "pipe",
    stderr: "pipe",
  });

  const events = [];
  const waiters = new Map();
  let output = "";

  const emit = event => {
    const waiter = waiters.get(event.event);
    if (waiter) {
      waiters.delete(event.event);
      waiter(event);
    } else {
      events.push(event);
    }
  };

  const nextEvent = name => {
    const index = events.findIndex(event => event.event === name);
    if (index !== -1) return Promise.resolve(events.splice(index, 1)[0]);
    return new Promise(resolve => waiters.set(name, resolve));
  };

  const readOutput = (async () => {
    for await (const chunk of proc.stdout) {
      output += new TextDecoder().decode(chunk);
      let newline;
      while ((newline = output.indexOf("\n")) !== -1) {
        const line = output.slice(0, newline).trim();
        output = output.slice(newline + 1);
        if (line) emit(JSON.parse(line));
      }
    }
  })();
  const stderr = proc.stderr.text();

  const ready = await nextEvent("ready");
  const base = `http://127.0.0.1:${ready.port}`;

  const slowRequest = fetch(`${base}/slow`).then(async response => {
    const body = await response.json();
    return { ...body, finishedAt: performance.now() };
  });
  await nextEvent("slow-started");

  const pings = await Promise.all(
    Array.from({ length: pingCount }, async () => {
      const startedAt = performance.now();
      const response = await fetch(`${base}/ping`);
      if (!response.ok) throw new Error(`ping failed with ${response.status}`);
      return {
        latency: performance.now() - startedAt,
        finishedAt: performance.now(),
      };
    }),
  );
  const slow = await slowRequest;

  await fetch(`${base}/stop`);
  await proc.exited;
  await readOutput;
  const errorOutput = await stderr;
  if (errorOutput) throw new Error(errorOutput);

  const latencies = pings.map(ping => ping.latency).sort((a, b) => a - b);
  return {
    mode,
    slowQueryMs: Number(slow.wallMs.toFixed(2)),
    completedBeforeSlowQuery: pings.filter(ping => ping.finishedAt < slow.finishedAt).length,
    pingP50Ms: Number(percentile(latencies, 0.5).toFixed(2)),
    pingP95Ms: Number(percentile(latencies, 0.95).toFixed(2)),
    pingP99Ms: Number(percentile(latencies, 0.99).toFixed(2)),
    pingMaxMs: Number(latencies.at(-1).toFixed(2)),
  };
}

const sync = await run("sync");
const async = await run("async");

if (sync.completedBeforeSlowQuery !== 0) {
  throw new Error("synchronous pings unexpectedly completed during the query");
}
if (async.completedBeforeSlowQuery < pingCount * 0.9) {
  throw new Error("AsyncDatabase did not keep the HTTP server responsive");
}

console.log("SQLite HTTP availability benchmark");
console.table([sync, async]);
