// Build prints: 2 x warn: TS100082: The build can't tell which file this Worker starts from. If that file isn't an entry point, the Worker fails to load
// The engine names the URL once. The warning stands at each start that is given it: under its name, and as its text.
if (process.argv.length > 5) {
  const url = new URL("./job.mjs", process.argv[5]);
  new Worker(url);
  new Worker(url.href);
}
console.log("none started");
