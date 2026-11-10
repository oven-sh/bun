// Build prints: 4 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// Type syntax between the start and its URL changes nothing of what the build follows.
const base: string = process.env.BASE_OF_JOBS ?? import.meta.url;
if (process.argv.length > 5) {
  new Worker(new URL("./job.ts", base) as URL);
  new Worker(new URL("./job.ts", base)!);
  new (Worker as any)(new URL("./job.ts", base));
  const url = new URL("./job.ts", base) as string | URL;
  new Worker(url);
}
console.log("none started");
