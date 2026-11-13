const { spawn } = require("child_process");
const out = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  { // 2: state after 150 ms with no consumer, child still alive
    const c = spawn("sh", ["-c", "printf hello; sleep 0.5"], { stdio: ["ignore", "pipe", "ignore"] });
    await sleep(150);
    out.idle = { readableLength: c.stdout.readableLength, flowing: c.stdout.readableFlowing, readable: c.stdout.readable, bufLen: c.stdout._readableState.buffer.length };
    const b = c.stdout.read();
    out.idleRead = b && String(b);
    out.idleRead2 = c.stdout.read();
    c.stdout.resume(); await new Promise(r => c.on("close", r));
  }
  { // 5: destroy before any read; child writes a lot
    const c = spawn("sh", ["-c", "head -c 1000000 /dev/zero; echo done >&2"], { stdio: ["ignore", "pipe", "pipe"] });
    let err = ""; c.stderr.on("data", d => (err += d));
    c.stdout.destroy();
    const [code, sig] = await new Promise(r => c.on("close", (a, b) => r([a, b])));
    out.destroyEarly = { code, sig, err: err.trim().slice(0, 40), destroyed: c.stdout.destroyed };
  }
  { // 11: once('readable') then read()
    const c = spawn("sh", ["-c", "printf abc; sleep 0.1; printf def"], { stdio: ["ignore", "pipe", "ignore"] });
    const seen = [];
    c.stdout.on("readable", () => { let b; while ((b = c.stdout.read()) !== null) seen.push(String(b)); });
    c.stdout.on("end", () => seen.push("end"));
    await new Promise(r => c.on("close", r));
    out.readable = seen;
  }
  { // read(n) exact sizes
    const c = spawn("sh", ["-c", "printf abcdefghij"], { stdio: ["ignore", "pipe", "ignore"] });
    const seen = [];
    c.stdout.on("readable", () => { let b; while ((b = c.stdout.read(3)) !== null) seen.push(String(b)); });
    c.stdout.on("end", () => seen.push("end"));
    await new Promise(r => c.on("close", r));
    out.readN = seen;
  }
  { // listener added, removed before data, stream left flowing without listener, re-added later
    const c = spawn("sh", ["-c", "sleep 0.1; printf one; sleep 0.2; printf two"], { stdio: ["ignore", "pipe", "ignore"] });
    const seen = []; const f = d => seen.push(String(d));
    c.stdout.on("data", f); c.stdout.off("data", f);
    setTimeout(() => c.stdout.on("data", f), 200);
    await new Promise(r => c.on("close", r));
    out.offOn = seen;
  }
  console.log(JSON.stringify(out));
})();
