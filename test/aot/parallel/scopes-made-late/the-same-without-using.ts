// A closure holds a constant that is declared below it.
async function drive(write: (queued: Promise<void>) => Promise<void>) {
  const calls: string[] = [];
  const first = async (outcome: string) => { calls.push("write " + outcome); await write(whenQueued.promise); calls.push("written"); };
  const queued: string[] = [];
  const whenQueued = Promise.withResolvers<void>();
  let queuedAt = 0;
  const second = (command: string) => { calls.push("queue"); queuedAt = 5; whenQueued.resolve(); queued.push(command); };
  second("n");
  await first("a");
  return calls.join() + "|" + queued.join() + "|" + queuedAt;
}
console.log(await drive(async queued => { await queued; console.log("waited"); }));
