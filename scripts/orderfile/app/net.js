// net_* features: the I/O of a command-line application, one kind per feature.
// fetch against a local server (JSON, server-sent events read two ways, POST
// bodies, abort, timeout, a proxy), node:http(s), net, tls and dns clients,
// hashing and ciphers, child processes, a filesystem scan, a worker, vm,
// events and timers, util.inspect, text codecs, Buffer, URL, os and process.
//
// Most fetch features talk plain HTTP to the local server: what they are after
// is the HTTP client itself. fetch_tls and fetch_insecure are the same client
// over TLS, with the server's certificate pinned and unverified. The servers run
// in an untraced child (servers.js).
import { bigObj, cert, drained, need, servers, tmpdir } from "./ctx.js";
let sink = 0;
// JSON.stringify(bigObj()) compressed with zstd ahead of time: an application decompresses far more than it compresses.
const ZSTD_JSON =
  "KLUv/aBuEgIAPJoAemtZJhxgS0FBcvjlndu59oQ5CALTXxERkfJgnI5hGCwBcwI1Ap4C27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27ZtmyRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJkiQlSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkQYJERERERERERERERERERET8/////////////2/btm3btm3btm3bdtu2bdu2bdu2bdu2JEmSJEmSJEmSJElu27Zt27Zt27Zt2yZJkiRJkiRJkiRJUpIkSZIkSZIkSZIkIYQQQgghhBBCCCGEEEIIIYQQBEEIgiAIQhAEQRCCIAiCEARBEIIQERERERERERERERERERHx/////////////79t27Zt27Zt27Zt223btm3btm3btm3bkiRJkiRJkiRJkiS5bdu2bdu2bdu2bZskSZIkSZIkSZIkSUmSJEmSJEmSJEmShBBCCCGEEEIIIYQQQgghhBBCRPy33ZbkNklJQggIPOABCjBgAQskMHAABQwgEDgkMLDAgAMUQMAAAgMBAA6QAAYUYAADCQws0AAFFhhAIEhggAAGGHBAABIYEMACAiDAgAMCERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERER/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////2/btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3bbdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bUuSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmS27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27ZtW9u2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2SZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSZIkSVKSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmShBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEiIiIiIiIiIiIiIiIiIiI//////////////9t27Zt27Zt27Zt227btm3btm3btm3bliRJkiRJkiRJkiTJbdu2bdu2bdu2bdskSZKCIAiCIAiCIAiCIIgIgiAIgiAIgiAEQRAEQRAEQRAEQRAEQRAEQRCCEIQQhBCEEIQQhBCEEIQQhBCEIERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERAQREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREREfH/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////tm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btm3btt22bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2bdu2JEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJEmSJLlt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27Zt27ZtW5bHqJRA/zoa+gBjHxAEBCipDBSAAQAAAgQICAAAIAEUqYGFJygAoPAPj0aj0WhoNBoNjYZGo9FoNDQ0Go1GR6PRaDRkNBqNRiOj0dBoNDIajUajsaHRaDQaGo1GQ6Oh0Wg0Gg2Nhkaj0dJoNBoNDY1Go9FoaDQaGo2GRqPRaHRoNBqNRkaj0WhoZDQajUYjo6HRaDQ2Go1Go0Gj0Wg0GhqNhkajodFoNBotDY1Go9HQaDQaGg2NRqPRaGg0NBqNjkaj0WjIaDQajUZGo9HQaGQ0Go1GY0Oj0Wg0NBqNRkNDo9FoNBoa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";
async function env() {
  const srv = await servers();
  const CERT = await cert();
  return {
    srv,
    CERT,
    base: `http://127.0.0.1:${srv.plainBun}`,
    common: {},
    tlsServer: { port: srv.tls },
    plainPort: srv.plain,
  };
}
let treeDone = false;
async function tree(tmp) {
  if (treeDone) return;
  treeDone = true;
  const { fs, path } = await need("fs", "path");
  for (let d = 0; d < 12; d++) {
    const dir = path.join(tmp, "src", "pkg" + d, "lib");
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 15; f++)
      fs.writeFileSync(
        path.join(dir, `file${f}.${["ts", "js", "json", "md"][f % 4]}`),
        `// file ${f}\nexport const x${f} = ${f};\n`.repeat(1 + (f % 5)),
      );
  }
  fs.symlinkSync(path.join(tmp, "src", "pkg0"), path.join(tmp, "link"));
  fs.writeFileSync(path.join(tmp, ".gitignore"), "node_modules\n*.log\n");
  await Bun.write(path.join(tmp, "big.bin"), new Uint8Array(3 << 20));
}
export const features = {
  async fetch_404() {
    const { base, common } = await env();
    sink += (await fetch(base + "/nope?a=1&b=ü", common)).status;
  },
  async fetch_post_json() {
    const { base, common } = await env();
    const response = await fetch(base + "/echo", {
      ...common,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bigObj()),
    });
    if (!response.ok) throw new Error(`POST /echo: ${response.status}`);
    sink += (await response.json()).got;
  },
  async fetch_post_blob() {
    const { base, common } = await env();
    sink += (
      await (
        await fetch(base + "/echo", { ...common, method: "POST", body: new Blob(["blob body ".repeat(1000)]) })
      ).json()
    ).got;
  },
  async fetch_file() {
    const { base, common } = await env();
    sink += (await (await fetch(base + "/file", common)).arrayBuffer()).byteLength;
  },
  async fetch_insecure() {
    const { tlsServer } = await env();
    const url = `https://127.0.0.1:${tlsServer.port}/json`;
    sink += (await (await fetch(url, { tls: { rejectUnauthorized: false } })).bytes()).length;
  },
  async fetch_tls() {
    const { tlsServer, CERT } = await env();
    const url = `https://127.0.0.1:${tlsServer.port}`;
    const tls = { ca: CERT };
    sink += (await (await fetch(url + "/json", { tls })).json()).data.length;
    // A second request on the kept-alive connection, streamed.
    const streamed = await fetch(url + "/sse", { tls, method: "POST", body: "{}" });
    if (!streamed.ok) throw new Error(`POST /sse: ${streamed.status}`);
    sink += (await streamed.text()).length;
  },
  async fetch_sse_iter() {
    const { base, common } = await env();
    for (let turn = 0; turn < 3; turn++) {
      const res = await fetch(base + "/sse", {
        ...common,
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", "x-turn": String(turn) },
        body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "hi " + turn }] }),
      });
      const td = new TextDecoder();
      let buf = "",
        events = 0;
      for await (const chunk of res.body) {
        buf += td.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const ev = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of ev.split("\n")) {
            if (line.startsWith("data: ") && line !== "data: [DONE]")
              events += JSON.parse(line.slice(6)).usage.out >= 0;
          }
        }
      }
      sink += events + res.status + (res.headers.get("content-type")?.length | 0);
    }
  },
  async fetch_sse_reader() {
    const { base, common } = await env();
    for (let turn = 0; turn < 3; turn++) {
      const res = await fetch(base + "/sse", {
        ...common,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turn }),
      });
      const rd = res.body.getReader();
      const td = new TextDecoder();
      let buf = "",
        events = 0;
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += td.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const p of parts) {
          const d = p.split("\n").find(l => l.startsWith("data:"));
          if (d && !d.includes("[DONE]")) events += JSON.parse(d.slice(5).trim()).i >= 0;
        }
      }
      sink += events;
    }
  },
  async fetch_abort() {
    const { base, common } = await env();
    const ac = new AbortController();
    const p = fetch(base + "/sse", { ...common, signal: ac.signal })
      .then(async r => {
        const rd = r.body.getReader();
        await rd.read();
        ac.abort();
        return rd.read();
      })
      .catch(e => {
        sink += e.name.length;
      });
    await p;
  },
  async fetch_timeout() {
    const { base, common } = await env();
    try {
      await fetch(base + "/slow", { ...common, signal: AbortSignal.timeout(50) });
    } catch (e) {
      sink += e.name === "TimeoutError";
    }
  },
  async fetch_proxy() {
    const { srv, base, common } = await env();
    const proxyURL = `http://user:pa%20ss@127.0.0.1:${srv.proxy}`;
    for (let i = 0; i < 2; i++)
      sink += (await (await fetch(base + "/json", { ...common, proxy: proxyURL })).json()).data.length;
    sink += (
      await (await fetch(base + "/sse", { ...common, proxy: { url: proxyURL, headers: { "proxy-x": "1" } } })).text()
    ).length;
  },
  async https_agent() {
    const { https, zlib } = await need("https", "zlib");
    const { CERT, tlsServer } = await env();
    const agent = new https.Agent({ keepAlive: true, ca: CERT, maxSockets: 4 });
    for (let i = 0; i < 3; i++)
      await new Promise((resolve, reject) => {
        const req = https.request(
          {
            host: "127.0.0.1",
            servername: "localhost",
            port: tlsServer.port,
            path: "/gzip",
            method: "GET",
            agent,
            headers: { "accept-encoding": "gzip" },
          },
          res => {
            const gun = zlib.createGunzip();
            res.pipe(gun);
            let s = "";
            gun.setEncoding("utf8");
            gun.on("data", d => (s += d));
            gun.on("end", () => {
              sink += JSON.parse(s).data.length + res.statusCode + Object.keys(res.headers).length;
              resolve();
            });
            gun.on("error", reject);
          },
        );
        req.on("error", reject);
        req.setTimeout(5000);
        req.end();
      });
    agent.destroy();
  },
  async http_client() {
    const { http } = await need("http");
    const { plainPort } = await env();
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: plainPort,
          path: "/x?y=1",
          method: "POST",
          headers: { "content-type": "text/plain", "transfer-encoding": "chunked" },
        },
        res => {
          res.setEncoding("utf8");
          let s = "";
          res.on("data", d => (s += d));
          res.on("end", () => {
            sink += JSON.parse(s).n;
            resolve();
          });
        },
      );
      req.on("error", reject);
      req.write("part1");
      req.write(Buffer.from("part2"));
      req.end("end");
    });
    sink += await new Promise((resolve, reject) =>
      http
        .get(`http://127.0.0.1:${plainPort}/get`, res => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        })
        .on("error", reject),
    );
  },
  async net_echo() {
    const { net } = await need("net");
    const { srv } = await env();
    const echo = { address: () => ({ port: srv.echo }), close() {} };
    const c = net.connect(echo.address().port, "127.0.0.1", () => {
      c.write("hello\n");
      c.write(Buffer.alloc(70000, 7));
      c.end();
    });
    c.setKeepAlive(true, 1000);
    sink += await drained(c, "net echo");
    echo.close();
  },
  async tls_connect() {
    const { tls } = await need("tls");
    const { CERT, tlsServer } = await env();
    const s = tls.connect(
      { host: "127.0.0.1", port: tlsServer.port, ca: CERT, servername: "localhost", ALPNProtocols: ["http/1.1"] },
      () => {
        if (!s.authorized) return s.destroy(new Error(`tls.connect: ${s.authorizationError}`));
        sink +=
          (s.getPeerCertificate()?.subject?.CN?.length | 0) +
          (s.getProtocol()?.length | 0) +
          (s.getCipher()?.name?.length | 0) +
          (s.alpnProtocol?.length | 0);
        s.write("GET /json HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      },
    );
    sink += await drained(s, "tls.connect");
  },
  async dns() {
    const { dns, util, net } = await need("dns", "util", "net");
    sink +=
      ((await dns.promises.lookup("localhost", { all: true })).length +
        (await util.promisify(dns.lookup)("127.0.0.1")).length) |
      0;
    sink +=
      net.isIP("::1") +
      net.isIPv4("1.2.3.4") +
      (new net.BlockList().addAddress("1.1.1.1"), 1) +
      new net.SocketAddress({ address: "127.0.0.1", port: 1 }).port;
  },
  async bun_zstd() {
    sink += Bun.zstdDecompressSync(Buffer.from(ZSTD_JSON, "base64")).length;
  },
  async hash() {
    const { crypto } = await need("crypto");
    const data = Buffer.from("The quick brown fox " + "x".repeat(10000));
    for (const alg of ["sha256", "sha1", "md5", "sha512"])
      sink +=
        (crypto.createHash(alg).update(data).update("more").digest("hex").length + crypto.hash?.(alg, "abc")?.length) |
        0;
  },
  async hmac_random() {
    const { crypto } = await need("crypto");
    const data = Buffer.from("The quick brown fox " + "x".repeat(10000));
    sink += crypto.createHmac("sha256", "secret").update(data).digest("base64").length;
    sink += crypto.randomUUID().length;
    sink += crypto.randomBytes(32).toString("base64url").length;
    sink += crypto.randomInt(100);
    sink += crypto.getRandomValues(new Uint32Array(8))[0] % 3;
    sink += crypto.timingSafeEqual(Buffer.from("abc"), Buffer.from("abc"));
  },
  async kdf() {
    const { crypto, util } = await need("crypto", "util");
    sink +=
      (crypto.pbkdf2Sync("pw", "salt", 1000, 32, "sha256").length +
        (await util.promisify(crypto.scrypt)("pw", "salt", 16)).length +
        crypto.createHash("sha256").copy?.().digest().length) |
      0;
  },
  async cipher() {
    const { crypto } = await need("crypto");
    const data = Buffer.from("The quick brown fox " + "x".repeat(10000));
    const key = crypto.randomBytes(32),
      iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(data), c.final()]);
    const tag = c.getAuthTag();
    const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    sink += Buffer.concat([d.update(enc), d.final()]).equals(data);
  },
  async spawn_pipe() {
    const { cp: _cp, events: _events, timersp: _timersp } = await need("cp", "events", "timersp");
    const { spawn } = _cp;
    const { once } = _events;
    const { setImmediate: yieldNow } = _timersp;
    const tmp = await tmpdir();
    const child = spawn("/bin/sh", ["-c", "cat; echo done >&2"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FOO: "bar" },
      cwd: tmp,
    });
    const closed = once(child, "close"),
      exited = once(child, "exit");
    let out = 0,
      err = "";
    child.stdout.on("data", d => (out += d.length));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", d => (err += d));
    for (let i = 0; i < 50; i++) {
      child.stdin.write("line " + i + " " + "y".repeat(200) + "\n");
      if (i % 10 === 0) await yieldNow();
    }
    child.stdin.end();
    const [code, sig] = await exited;
    await closed;
    sink += out;
    sink += err.length;
    sink += code | 0;
    sink += sig ? 1 : 0;
    sink += child.pid;
  },
  async exec_variants() {
    const { cp: _cp, util } = await need("cp", "util");
    const { exec, execFile, execSync, spawnSync, execFileSync } = _cp;
    const tmp = await tmpdir();
    sink += (await util.promisify(exec)("echo hi && ls -la | head -3", { cwd: tmp })).stdout.length;
    sink += (await util.promisify(execFile)("/bin/echo", ["a", "b"])).stdout.length;
    sink += execSync("uname -a", { encoding: "utf8" }).length;
    sink += spawnSync("/bin/sh", ["-c", "exit 3"]).status;
    sink += execFileSync("/bin/cat", { input: "piped" }).length;
  },
  async bun_spawn() {
    const bs = Bun.spawn(["/bin/sh", "-c", "for i in 1 2 3 4 5; do echo tick $i; sleep 0.05; done; exec sleep 60"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      onExit() {
        sink++;
      },
    });
    const rd = bs.stdout.getReader();
    let ticks = 0;
    while (ticks < 3) {
      const { value, done } = await rd.read();
      if (done) break;
      ticks += new TextDecoder().decode(value).split("tick").length - 1;
    }
    rd.releaseLock();
    if (ticks < 3) throw new Error(`Bun.spawn: read ${ticks} of the child's lines before its output ended`);
    bs.kill("SIGTERM");
    sink += (await bs.exited) | 0;
    if (bs.signalCode !== "SIGTERM") throw new Error(`Bun.spawn: the child ended with ${bs.signalCode ?? bs.exitCode}`);
    sink += bs.signalCode.length;
    sink += bs.resourceUsage()?.maxRSS > 0;
  },
  async bun_spawnsync() {
    const bs2 = Bun.spawnSync({ cmd: ["/bin/echo", "sync"], stdout: "pipe" });
    sink += bs2.stdout.length;
    sink += bs2.exitCode;
  },
  async which_kill() {
    sink += Bun.which("sh")?.length | 0;
    try {
      process.kill(process.pid, 0);
      sink++;
    } catch {}
  },
  async fs_watch() {
    const { fs, path, timersp: _timersp } = await need("fs", "fsp", "path", "timersp");
    const { setTimeout: sleep } = _timersp;
    const tmp = await tmpdir();
    await tree(tmp);
    const watcher = fs.watch(path.join(tmp, "src"), { recursive: true });
    let evs = 0;
    watcher.on("change", () => evs++);
    await sleep(100);
    watcher.close();
    sink += evs;
  },
  async fs_readdir() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    await tree(tmp);
    const ents = await fsp.readdir(tmp, { recursive: true, withFileTypes: true });
    sink += ents.filter(e => e.isFile()).length;
    sink += ents.filter(e => e.isDirectory()).length;
    sink += ents.filter(e => e.isSymbolicLink()).length;
    sink += fs.readdirSync(path.join(tmp, "src")).length;
    sink += (await fsp.readdir(path.join(tmp, "src", "pkg1", "lib"))).length;
  },
  async fs_stat_read() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    await tree(tmp);
    const ents = await fsp.readdir(tmp, { recursive: true, withFileTypes: true });
    sink += ents.filter(e => e.isFile()).length;
    sink += ents.filter(e => e.isDirectory()).length;
    sink += ents.filter(e => e.isSymbolicLink()).length;
    let n = 0;
    for (const e of ents) {
      if (!e.isFile()) continue;
      const p = path.join(e.parentPath ?? e.path, e.name);
      const st = n % 2 ? fs.statSync(p) : await fsp.stat(p);
      sink += st.size + (st.mtimeMs % 2) + st.isFile();
      if (n % 3 === 0) sink += fs.lstatSync(p).mode & 1;
      if (n % 5 === 0) sink += (await fsp.readFile(p, "utf8")).length;
      else if (n % 5 === 1) sink += fs.readFileSync(p).length;
      n++;
    }
  },
  async fs_realpath() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    await tree(tmp);
    sink += fs.realpathSync(path.join(tmp, "link")).length;
    sink += (await fsp.realpath(tmp)).length;
    sink += fs.existsSync(path.join(tmp, "nope"));
    sink += await fsp.access(tmp).then(
      () => 1,
      () => 0,
    );
    sink += fs.readlinkSync(path.join(tmp, "link")).length;
    sink += fs.statSync(path.join(tmp, "nope"), { throwIfNoEntry: false }) ? 1 : 0;
  },
  async fs_errors() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    try {
      fs.readFileSync(path.join(tmp, "missing.txt"));
    } catch (e) {
      sink += e.code.length + e.message.length;
    }
    try {
      await fsp.mkdir(tmp);
    } catch (e) {
      sink += e.errno | 0;
    }
  },
  async glob() {
    const { fs, fsp } = await need("fs", "fsp");
    const tmp = await tmpdir();
    await tree(tmp);
    sink +=
      [...new Bun.Glob("**/*.{ts,json}").scanSync({ cwd: tmp })].length +
      (fs.globSync ? fs.globSync("src/**/file1*.js", { cwd: tmp }).length : 0) +
      (await Array.fromAsync(fsp.glob?.("**/*.md", { cwd: tmp }) ?? [])).length;
  },
  async fs_mutate() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    await tree(tmp);
    fs.appendFileSync(path.join(tmp, ".gitignore"), "dist\n");
    await fsp.writeFile(path.join(tmp, "src", "pkg2", "lib", "new.ts"), "x");
    fs.renameSync(path.join(tmp, "src", "pkg2", "lib", "new.ts"), path.join(tmp, "src", "new2.ts"));
    fs.copyFileSync(path.join(tmp, "src", "new2.ts"), path.join(tmp, "copy.ts"));
    await fsp.cp(path.join(tmp, "src", "pkg3"), path.join(tmp, "pkg3copy"), { recursive: true });
    fs.utimesSync(path.join(tmp, "copy.ts"), new Date(), new Date(0));
    fs.chmodSync(path.join(tmp, "copy.ts"), 0o600);
    fs.truncateSync(path.join(tmp, "copy.ts"), 0);
  },
  async fs_fd() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    await tree(tmp);
    const fd = fs.openSync(path.join(tmp, "big.bin"), "r+");
    const b = Buffer.alloc(65536);
    sink += fs.readSync(fd, b, 0, b.length, 1 << 20);
    sink += fs.writeSync(fd, "tail", 100);
    sink += fs.fstatSync(fd).size;
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const fh = await fsp.open(path.join(tmp, "big.bin"));
    sink += (await fh.read(Buffer.alloc(4096), 0, 4096, 0)).bytesRead;
    sink += (await fh.stat()).size;
    await fh.close();
  },
  async fs_streams() {
    const { fs, path, stream: _stream, streamp: _streamp } = await need("fs", "path", "stream", "streamp");
    const { Transform } = _stream;
    const { pipeline: pipelineP } = _streamp;
    const tmp = await tmpdir();
    await tree(tmp);
    await pipelineP(
      fs.createReadStream(path.join(tmp, "big.bin"), { highWaterMark: 1 << 16 }),
      new Transform({
        transform(c, e, cb) {
          cb(null, c.subarray(0, c.length >> 1));
        },
      }),
      fs.createWriteStream(path.join(tmp, "half.bin")),
    );
  },
  async bun_write() {
    const { path } = await need("path");
    const tmp = await tmpdir();
    await tree(tmp);
    await Bun.write(path.join(tmp, "half.bin"), "x");
  },
  async path_url() {
    const { path, url: _url } = await need("path", "url");
    const { fileURLToPath, pathToFileURL } = _url;
    const tmp = await tmpdir();
    sink += path.relative(tmp, path.join(tmp, "src", "a.ts")).length;
    sink += path.resolve("a", "../b").length;
    sink += path.parse("/x/y.tar.gz").ext.length;
    sink += path.posix.normalize("/a//b/../c").length;
    sink += path.isAbsolute("x");
    sink += path.extname(".bashrc").length;
    sink += pathToFileURL(tmp).href.length;
    sink += fileURLToPath("file:///tmp/x").length;
    sink += path.toNamespacedPath(tmp).length;
  },
  async message_channel() {
    const { port1, port2 } = new MessageChannel();
    const got = new Promise(r => (port2.onmessage = e => r(e.data)));
    const ab = new ArrayBuffer(1024);
    port1.postMessage({ ab, n: 1 }, [ab]);
    sink += (await got).ab.byteLength;
    sink += ab.byteLength;
    port1.close();
    port2.close();
  },
  async node_message_channel() {
    const { worker_threads: _worker_threads, events: _events } = await need("worker_threads", "events");
    const { MessageChannel: NodeMC } = _worker_threads;
    const { once } = _events;
    const nmc = new NodeMC();
    nmc.port1.postMessage("x");
    sink += (await once(nmc.port2, "message")).length;
    nmc.port1.close();
    nmc.port2.close();
  },
  async vm() {
    const { vm } = await need("vm");
    const ctx = vm.createContext({ x: 2, console, out: [] });
    sink +=
      new vm.Script("out.push(x * 21); out.length", { filename: "v.js" }).runInContext(ctx) +
      vm.runInNewContext("a + b", { a: 1, b: 2 }) +
      vm.compileFunction("return q * 2", ["q"])(4) +
      (vm.isContext(ctx) ? 1 : 0) +
      new vm.Script("1+1").runInThisContext();
  },
  async eventtarget() {
    const et = new EventTarget();
    et.addEventListener("x", e => (sink += e.detail | 0), { once: true });
    et.dispatchEvent(new CustomEvent("x", { detail: 3 }));
    et.dispatchEvent(new Event("x"));
    sink += AbortSignal.any([AbortSignal.timeout(10000), new AbortController().signal]).aborted ? 0 : 1;
  },
  async als() {
    const { async_hooks: _async_hooks, timersp: _timersp } = await need("async_hooks", "timersp");
    const { AsyncLocalStorage, AsyncResource } = _async_hooks;
    const { setTimeout: sleep, setImmediate: yieldNow } = _timersp;
    const als = new AsyncLocalStorage();
    await als.run({ rid: 7 }, async () => {
      await sleep(1);
      await new Promise(r => setImmediate(r));
      sink += als.getStore().rid;
      const ar = new AsyncResource("X");
      ar.runInAsyncScope(() => (sink += als.getStore()?.rid | 0));
      process.nextTick(() => (sink += als.getStore().rid));
      await yieldNow();
    });
  },
  async timers() {
    const { timersp: _timersp } = await need("timersp");
    const { setTimeout: sleep } = _timersp;
    const t = setInterval(() => sink++, 5);
    t.unref();
    t.ref();
    const t2 = setTimeout(() => {}, 10000);
    t2.unref();
    sink += t2.hasRef() ? 0 : 1;
    t2.refresh();
    clearTimeout(t2);
    await sleep(12);
    clearInterval(t);
    const im = setImmediate(() => {});
    clearImmediate(im);
    queueMicrotask(() => sink++);
  },
  async perf() {
    const { perf_hooks: _perf_hooks, timersp: _timersp } = await need("perf_hooks", "timersp");
    const { performance: perf, PerformanceObserver } = _perf_hooks;
    const { setTimeout: sleep } = _timersp;
    performance.mark("a");
    await sleep(1);
    performance.mark("b");
    performance.measure("ab", "a", "b");
    sink +=
      performance.getEntriesByType("measure").length +
      (performance.timeOrigin > 0) +
      (perf.now() % 1) +
      (performance.eventLoopUtilization?.().utilization >= 0 ? 1 : 0);
    performance.clearMarks();
    const po = new PerformanceObserver(() => {});
    po.observe({ entryTypes: ["mark"] });
    po.disconnect();
  },
  async diagnostics_channel() {
    const { dc } = await need("dc");
    const ch = dc.channel("orderfile.test");
    ch.subscribe(m => (sink += m.n));
    if (ch.hasSubscribers) ch.publish({ n: 1 });
  },
  async inspect() {
    const { util } = await need("util");
    const circ = {
      a: 1,
      m: new Map([["k", { deep: [1, 2, { deeper: new Set([1]) }] }]]),
      p: new Proxy({}, {}),
      f() {},
      s: Symbol("s"),
      d: new Date(),
      re: /x/gi,
      err: new RangeError("r"),
      big: 10n,
      buf: Buffer.from("abc"),
      ta: new Float32Array(3),
      get g() {
        return 1;
      },
      [Symbol("k")]: 1,
      nul: Object.create(null),
      cls: new (class Foo {
        x = 1;
      })(),
      long: "x".repeat(200),
      arr: bigObj().data.slice(0, 120),
    };
    circ.self = circ;
    sink +=
      util.inspect(circ, { depth: 4, colors: true, showHidden: true, getters: true }).length +
      util.inspect(circ, { compact: false, breakLength: 60, sorted: true, maxArrayLength: 10 }).length +
      util.format("%s %d %i %f %j %o %O %%", "s", 1.5, 2.9, 3, { a: 1 }, [1], circ.m).length +
      Bun.inspect(circ).length +
      util.inspect(new Error("x", { cause: circ.err })).length +
      util.formatWithOptions({ colors: true }, "%o", process.versions).length;
  },
  async text_codec() {
    const { string_decoder: _string_decoder } = await need("string_decoder");
    const { StringDecoder } = _string_decoder;
    const te = new TextEncoder(),
      td = new TextDecoder("utf-8", { fatal: false }),
      td16 = new TextDecoder("utf-16le"),
      tdl = new TextDecoder("latin1"),
      tds = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const u = te.encode("héllo ✓ 🙂 ".repeat(500));
    sink += td.decode(u).length;
    sink += td16.decode(new Uint16Array([104, 105]).buffer).length;
    sink += tdl.decode(new Uint8Array([233, 65])).length;
    sink += te.encodeInto("abc", new Uint8Array(8)).written;
    sink += td.decode(u.subarray(0, 7), { stream: true }).length;
    sink += td.decode().length;
    try {
      tds.decode(new Uint8Array([0xff]));
    } catch {
      sink++;
    }
    const sd = new StringDecoder("utf8");
    sink += sd.write(Buffer.from([0xe2, 0x9c])).length;
    sink += sd.end(Buffer.from([0x93])).length;
  },
  async buffer() {
    const bf = Buffer.from("héllo wörld ✓", "utf8");
    sink +=
      bf.toString("base64").length +
      bf.toString("hex").length +
      bf.toString("latin1").length +
      bf.toString("utf16le").length +
      bf.toString("base64url").length +
      bf.toString("ascii", 1, 5).length +
      Buffer.from(bf.toString("base64"), "base64").equals(bf) +
      Buffer.byteLength("✓✓", "utf8") +
      Buffer.concat([bf, Buffer.alloc(5), Buffer.allocUnsafe(3).fill(1)]).length +
      bf.indexOf("wörld") +
      bf.includes(Buffer.from("✓")) +
      Buffer.compare(bf, Buffer.from("a")) +
      (bf.readUInt32LE(0) % 2) +
      Number(bf.readBigUInt64BE(0) % 2n) +
      Buffer.alloc(8).writeDoubleLE(1.5) +
      bf.subarray(1, 3).length +
      bf.toJSON().data.length +
      bf.swap16?.call(Buffer.alloc(4)).length +
      Buffer.from(new Uint16Array([1, 2]).buffer).length +
      Buffer.from([1, 2, 3]).reverse()[0] +
      bf.copy(Buffer.alloc(32), 2) +
      bf.write("xy", 1, "latin1") +
      Buffer.isEncoding("hex") +
      (Buffer.poolSize % 3) +
      new Blob([bf, "x"]).size +
      (await new Blob([bf]).text()).length +
      (await new Response(new Blob([bf]).stream()).blob()).size;
  },
  async url() {
    const { querystring } = await need("querystring");
    const url = new URL("https://user:pw@example.com:8443/a/b/../c?x=1&y=%E2%9C%93#frag");
    url.searchParams.append("z", "ü");
    url.searchParams.sort();
    sink +=
      url.href.length +
      url.origin.length +
      [...url.searchParams].length +
      new URLSearchParams({ a: "1", b: "2" }).toString().length +
      URL.canParse("nope") +
      (URL.parse?.("http://x") ? 1 : 0) +
      querystring.parse("a=1&b=2&b=3").b.length +
      querystring.stringify({ q: "ü v" }).length +
      new URL("file:///C:/x").pathname.length +
      encodeURI("a b").length;
  },
  async os() {
    const { os } = await need("os");
    sink +=
      os.homedir().length +
      os.tmpdir().length +
      os.cpus().length +
      (os.totalmem() > os.freemem()) +
      Object.keys(os.networkInterfaces()).length +
      os.release().length +
      os.hostname().length +
      os.loadavg().length +
      (os.uptime() > 0) +
      os.EOL.length +
      os.platform().length +
      os.arch().length +
      os.endianness().length +
      os.availableParallelism() +
      os.version().length +
      os.machine().length +
      (os.constants.signals.SIGTERM | 0);
  },
  async process_info() {
    const { tty } = await need("tty");
    const mu = process.memoryUsage();
    sink += mu.rss > mu.heapUsed;
    sink += process.memoryUsage.rss() % 2;
    sink += process.cpuUsage().user % 2;
    sink += Number(process.hrtime.bigint() % 2n);
    sink += process.hrtime()[0];
    sink += process.resourceUsage().maxRSS % 2;
    sink += process.uptime() > 0;
    sink += process.pid % 2;
    sink += process.ppid % 2;
    sink += process.argv.length;
    sink += process.execPath.length;
    sink += process.cwd().length;
    sink += process.title.length;
    sink += process.umask();
    sink += Object.keys(process.env).length;
    sink += process.version.length;
    sink += Object.keys(process.versions).length;
    sink += process.getuid?.() >= 0;
    sink += process.arch.length;
    sink += process.stdout.isTTY ? 1 : 0;
    sink += tty.isatty(0);
    sink += process.stdin.isTTY ? 1 : 0;
    sink += Object.keys(process.features ?? {}).length;
    sink += process.execArgv.length;
    sink += process.report?.getReport ? 1 : 0;
    sink += process.emitWarning.length;
  },
  async signals() {
    const { timersp: _timersp } = await need("timersp");
    const { setTimeout: sleep } = _timersp;
    const tmp = await tmpdir();
    const onSig = () => sink++;
    process.on("SIGWINCH", onSig);
    process.on("SIGUSR2", onSig);
    process.kill(process.pid, "SIGUSR2");
    await sleep(20);
    process.off("SIGWINCH", onSig);
    process.off("SIGUSR2", onSig);
    process.on("warning", () => sink++);
    process.emitWarning("careful", { code: "ORDERFILE" });
    const cwd = process.cwd();
    process.chdir(tmp);
    process.chdir(cwd);
    process.env.ORDERFILE_X = "1";
    delete process.env.ORDERFILE_X;
  },
  async assert() {
    const { assert } = await need("assert");
    assert.deepStrictEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] });
    assert.ok(1);
    try {
      assert.strictEqual(1, 2, "nope");
    } catch (e) {
      sink += e.message.length + (e.generatedMessage ? 0 : 1);
    }
    assert.match("abc", /b/);
    assert.throws(() => {
      throw new TypeError("t");
    }, TypeError);
    await assert.rejects(Promise.reject(new Error("r")));
  },
  async bun_utils() {
    sink += Bun.stringWidth("héllo \x1b[31m日本語\x1b[0m 👩‍👩‍👧");
    sink += Bun.stripANSI("\x1b[1mx\x1b[0m").length;
    sink += Bun.escapeHTML("<a href='x'>&</a>".repeat(100)).length;
    sink += Bun.semver.satisfies("1.4.3", "^1.2.0") ? 1 : 0;
    sink += Bun.semver.order("1.0.0", "1.0.1");
    sink += Bun.nanoseconds() % 2;
    sink += Bun.fileURLToPath("file:///x").length;
    sink += Bun.version.length;
    sink += Bun.revision.length;
    sink += Bun.peek(Promise.resolve(3)) | 0;
    sink += (await Bun.readableStreamToText(new Blob(["rs"]).stream())).length;
    sink += (await Bun.readableStreamToArray(new Blob(["a"]).stream())).length;
    sink += Bun.randomUUIDv7().length;
    sink += Bun.env.PATH?.length | 0;
    sink += Bun.sliceAnsi ? Bun.sliceAnsi("\x1b[31mhello\x1b[0m world", 2, 8).length : 0;
    sink += Bun.wrapAnsi ? Bun.wrapAnsi("word ".repeat(50) + "\x1b[32mgreen words here\x1b[0m", 20).length : 0;
    await Bun.sleep(1);
  },
};
export const checksum = () => sink;
