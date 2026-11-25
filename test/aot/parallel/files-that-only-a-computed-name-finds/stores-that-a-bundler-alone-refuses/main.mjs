// No site spells late.mjs, so `bun build` puts it into no bundle, and what a bundler alone refuses throws there when it runs: a store to an import, a store to a member of a namespace object, its removal.
const name = process.argv.length > 100 ? "never" : "late";
try {
  const late = await import("./" + name + ".mjs");
  console.log("loaded");
  for (const line of late.seen) console.log(line);
} catch (e) {
  console.log("the load fails:", e.name + ": " + e.message);
}
