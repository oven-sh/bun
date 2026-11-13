// Ports of "a listener attached late" tests to the fd route. argv: fd|std  listen|read  [facade opts JSON]
const [mode, how, optsJson] = process.argv.slice(2);
const writer = 'process.stdout.write(Buffer.alloc(3000, "o")); process.stderr.write(Buffer.alloc(3000, "e"));';
const c = mode === "fd"
  ? require("./fdroute.cjs").spawnFd(process.execPath, ["-e", writer], JSON.parse(optsJson || "{}"))
  : require("node:child_process").spawn(process.execPath, ["-e", writer], { stdio: ["ignore", "pipe", "pipe"] });
const got = { stdout: "", stderr: "" };
const events = [];
let read;
c.on("exit", code => {
  events.push("exit " + code);
  if (how === "read") { const chunk = c.stdout.read(); read = chunk === null ? null : chunk.length; return; }
  for (const name of ["stdout", "stderr"]) {
    c[name].on("data", d => (got[name] += d));
    c[name].on("end", () => events.push(name + " end"));
  }
});
const t = setTimeout(() => { console.log(JSON.stringify({ how, TIMEOUT: true, read, out: got.stdout.length, err: got.stderr.length, events })); process.exit(0); }, 3000);
c.on("close", code => {
  clearTimeout(t);
  events.push("close " + code);
  console.log(JSON.stringify(how === "read" ? { read, code } : { stdout: got.stdout.length, stderr: got.stderr.length, events: events.sort() }));
});
