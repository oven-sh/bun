// The first entry point of an executable that holds many programs. The other entry points are ./group-<n>.<extension>, which run-batch.ts writes: each imports the one
// program of its group that BATCH_PROGRAM names. This file runs the programs whose indexes it is given, each in a Worker, one after the other. Behind what a program
// printed it prints a line with BATCH_MARK, the index and how the program ended, to both streams. `bun run` of this file does the same with the files on disk.
//
//   <programs in a group> <extension> <index> ..
const [programsInGroup, extension, ...indexes] = process.argv.slice(2);
const mark = process.env.BATCH_MARK ?? "=== ended";
const maxMilliseconds = Number(process.env.BATCH_MILLISECONDS ?? 2000);
const maxBytes = Number(process.env.BATCH_MEGABYTES ?? 512) * 2 ** 20;
// With BATCH_ENDS_WITHIN=<milliseconds>, each Worker is ended at a moment drawn from that span, whatever the program is doing then.
const endsWithin = Number(process.env.BATCH_ENDS_WITHIN ?? 0);
// With BATCH_AT_ONCE=<number> as well, that many Workers run at the same time. Their marks follow when all of them have ended.
const atOnce = endsWithin ? Number(process.env.BATCH_AT_ONCE ?? 1) : 1;

async function runInAWorker(index: string) {
  const bytesBefore = process.memoryUsage.rss();
  const group = new URL(`./group-${Math.floor(Number(index) / Number(programsInGroup))}.${extension}`, import.meta.url)
    .href;
  // This file is built with the programs, under their tsconfig.json (run-batch.ts, --options-of-the-project). One without Bun's types knows no `env` among the options of a Worker, and which
  // types have a name at all goes by the libraries that it loads.
  const worker = new Worker(group, { env: { ...process.env, BATCH_PROGRAM: index } } as any);
  let stoppedBy = "";
  const stop = (reason: string) => {
    stoppedBy ||= reason;
    worker.terminate();
  };
  const clock = endsWithin
    ? setTimeout(stop, Math.random() * endsWithin, "early")
    : setTimeout(stop, maxMilliseconds, "time");
  const meter = setInterval(() => {
    if (process.memoryUsage.rss() - bytesBefore > maxBytes) stop("memory");
  }, 10);
  // After an "error" event the exit code says nothing more: a Worker that imports a module which leaves a rejection unhandled closes with 0 or with 1.
  let failed = false;
  worker.addEventListener("error", event => {
    failed = true;
    console.error(String((event as ErrorEvent).message));
  });
  const exitCode = await new Promise<number>(resolve =>
    worker.addEventListener("close", event => resolve((event as Event & { code: number }).code)),
  );
  clearTimeout(clock);
  clearInterval(meter);
  return stoppedBy || (failed ? "error" : exitCode);
}

for (let first = 0; first < indexes.length; first += atOnce) {
  const together = indexes.slice(first, first + atOnce);
  const ends = await Promise.all(together.map(runInAWorker));
  together.forEach((index, at) => {
    console.log(`\n${mark} ${index} ${ends[at]}`);
    console.error(`\n${mark} ${index} ${ends[at]}`);
  });
}
