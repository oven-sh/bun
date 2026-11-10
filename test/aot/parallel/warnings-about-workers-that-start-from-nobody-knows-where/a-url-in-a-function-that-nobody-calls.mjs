// Build prints: 1 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The load sees both starts with their URLs. The engine names the URL of the one that runs: it looks at no function that nothing calls.
const base = process.env.BASE_OF_JOBS ?? import.meta.url;
function never() {
  const url = new URL("./job.mjs", base);
  return new Worker(url);
}
function once() {
  const url = new URL("./job.mjs", base);
  if (process.argv.length > 5) new Worker(url);
}
once();
console.log("none started");
