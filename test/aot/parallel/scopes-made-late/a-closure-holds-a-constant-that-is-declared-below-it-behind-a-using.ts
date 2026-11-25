// A closure handed to one `using` holds a constant that is declared below it, behind more `using` declarations.
const held = <T extends Function>(run: T): Disposable & { run: T } => ({ run, [Symbol.dispose]() {} });
async function drive({ write = async (_queued: Promise<void>) => {} }: { write?: (queued: Promise<void>) => Promise<void> } = {}) {
  using _env = held(() => 0);
  const calls: string[] = [];
  using _write = held(async (outcome: string) => { calls.push("write " + outcome); await write(whenQueued.promise); calls.push("written"); });
  using _remove = held(async () => { calls.push("delete"); });
  const queued: string[] = [];
  const whenQueued = Promise.withResolvers<void>();
  let queuedAt = 0;
  using _enqueue = held((command: string) => { calls.push("queue"); queuedAt = 5; whenQueued.resolve(); queued.push(command); });
  _enqueue.run("n");
  await _write.run("a");
  await _remove.run();
  return calls.join() + "|" + queued.join() + "|" + queuedAt;
}
console.log(await drive());
console.log(await drive({ write: async queued => { await queued; console.log("waited"); } }));
