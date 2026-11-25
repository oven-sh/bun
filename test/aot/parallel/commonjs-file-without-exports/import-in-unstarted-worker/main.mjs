function pick(go) {
  if (!go) return;
  import.meta.require("./plain.cjs");
}
pick(true);
if (process.argv.length > 99) new Worker(new URL("./worker.mjs", import.meta.url).href);
console.log("end");
