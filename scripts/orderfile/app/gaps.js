// gap_* features: paths a long-running compiled CLI enters that none of the other
// modules reach — a unix-socket control server, TLS started over an existing
// socket behind a CONNECT tunnel, callback-style async fs, builtin-module
// lookups, socket backpressure, CommonJS files embedded in the executable and
// required at run time, subprocesses that print nothing, and (gap_idle) the
// state of an application waiting at its prompt: open sockets, watchers and a
// listener, garbage from the work so far, then ten quiet seconds so the idle
// collector and the finalizers it triggers run.
import { base, cert, drained, firstChunk, need, servers, SOCKET_DEADLINE_MS, socketPath, tmpdir } from "./ctx.js";
let sink = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// bun's idle collector runs its first full collection after ~10 s without heap growth.
const IDLE_MS = 11500;
export const features = {
  async gap_unix_listen() {
    const { net } = await need("net", "path");
    const sock = await socketPath("ctl.sock");
    const server = net.createServer(c => {
      c.setEncoding("utf8");
      c.on("data", d => {
        c.write(JSON.stringify({ ok: true, echo: d.length }) + "\n");
      });
      c.on("error", () => {});
    });
    await new Promise((resolve, reject) => server.once("error", reject).listen(sock, resolve));
    server.unref();
    sink += String(server.address()).length;
    await new Promise(r => server.close(r));
  },
  async gap_tls_upgrade() {
    const { net, tls } = await need("net", "tls");
    const srv = await servers();
    const CERT = await cert();
    const tunnel = async headers => {
      const raw = net.connect(srv.proxy, "127.0.0.1", () =>
        raw.write(`CONNECT localhost:${srv.tls} HTTP/1.1\r\nHost: localhost:${srv.tls}\r\n${headers}\r\n`),
      );
      const status = (await firstChunk(raw, "CONNECT")).toString("latin1").split("\r\n", 1)[0];
      if (!/^HTTP\/1\.[01] 200/.test(status)) {
        raw.destroy();
        throw new Error(`CONNECT: ${status}`);
      }
      return raw;
    };
    for (let i = 0; i < 2; i++) {
      const raw = await tunnel(`Proxy-Authorization: Basic ${Buffer.from("u:p").toString("base64")}\r\n`);
      const s = tls.connect({ socket: raw, servername: "localhost", ca: CERT, ALPNProtocols: ["http/1.1"] }, () => {
        if (!s.authorized) return s.destroy(new Error(`tls over CONNECT: ${s.authorizationError}`));
        s.write("GET /json HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      });
      sink += await drained(s, "tls over CONNECT");
    }
    const { https } = await need("https");
    const agent = new https.Agent({ keepAlive: true, ca: CERT });
    agent.createConnection = (opts, cb) => {
      tunnel("").then(raw => cb(null, tls.connect({ socket: raw, servername: "localhost", ca: CERT })), cb);
    };
    await new Promise((resolve, reject) => {
      const req = https.request(
        { host: "127.0.0.1", servername: "localhost", port: srv.tls, path: "/json", agent },
        res => {
          let n = 0;
          res.on("data", d => (n += d.length));
          res.on("error", reject);
          res.on("end", () => {
            sink += n;
            if (res.statusCode === 200 && n > 0) resolve();
            else reject(new Error(`https over CONNECT: ${res.statusCode}, ${n} bytes`));
          });
        },
      );
      req.setTimeout(SOCKET_DEADLINE_MS, () => req.destroy(new Error("https over CONNECT: timed out")));
      req.on("error", reject);
      req.end();
    });
    agent.destroy();
  },
  async gap_fs_async() {
    const { fs, fsp, path } = await need("fs", "fsp", "path");
    const tmp = await tmpdir();
    const f = path.join(tmp, "a.txt"),
      l = path.join(tmp, "a.link");
    fs.writeFileSync(f, "x".repeat(100));
    for (let i = 0; i < 3; i++) {
      await new Promise(r => fs.symlink(f, l + i, r));
      sink +=
        (await new Promise(r => fs.readlink(l + i, (e, p) => r(p ?? "")))).length + (await fsp.readlink(l + i)).length;
      const fd = fs.openSync(f, "r");
      await new Promise(r => fs.fchmod(fd, 0o644, r));
      await new Promise(r =>
        fs.fstat(fd, (e, st) => {
          sink += st.mtime.getTime() > 0;
          r();
        }),
      );
      fs.closeSync(fd);
      await new Promise(r => fs.unlink(l + i, r));
      const st = await fsp.stat(f);
      sink += st.mtime.getFullYear() + st.ctime.getMonth() + st.birthtime.getDay() + st.atime.getDate();
      await fsp.chmod(f, 0o600);
      await fsp.writeFile(f + i, "y");
      await fsp.unlink(f + i);
      await new Promise(r =>
        fs.lstat(f, (e, s) => {
          sink += s.mtimeMs > 0;
          r();
        }),
      );
    }
  },
  async gap_builtins() {
    const m = await import("node:module");
    sink += m.builtinModules.length;
    sink += m.isBuiltin?.("node:fs") ? 1 : 0;
    sink += Object.keys(process.getBuiltinModule("node:path")).length;
    sink += Object.keys(process.getBuiltinModule("os")).length;
    const c = await import("node:constants");
    sink += Object.keys(c).length;
    const p = await import("node:process");
    sink += p.default.pid > 0;
    const onSig = () => {};
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);
    sink += process.listeners("SIGINT").length;
    sink += process.listenerCount("SIGTERM");
    sink += process.rawListeners("SIGINT").length;
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
    sink += process.getgid();
    sink += process.getegid();
    sink += process.geteuid();
    sink += process.platform.length;
    sink += process.arch.length;
    sink += process.getgroups?.().length | 0;
    const { util } = await need("util");
    sink += util.types.isProxy(new Proxy({}, {}));
    sink += util.types.isProxy({});
    sink += util.types.isGeneratorFunction(function* () {});
    sink += util.types.isAsyncFunction(async () => {});
    sink += util.types.isNativeError(new Error());
    sink += util.types.isRegExp(/x/);
    sink += util.types.isMap(new Map());
    sink += util.types.isExternal({});
    sink += util.types.isBoxedPrimitive(Object(1));
  },
  async gap_http_plain() {
    const srv = await servers();
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`http://127.0.0.1:${srv.plain}/v1/log?i=${i}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "x", i, data: "d".repeat(2000) }),
        keepalive: true,
      });
      sink += (await r.json()).n + (r.headers.get("connection")?.length | 0);
    }
    sink += (await (await fetch(`http://127.0.0.1:${srv.plain}/get`)).text()).length;
  },
  async gap_base64() {
    const b64 = Buffer.from("héllo wörld ✓ ".repeat(40)).toString("base64");
    const wrapped = b64.replace(/(.{76})/g, "$1\n");
    sink += Buffer.from(wrapped, "base64").length;
    sink += Buffer.from(" " + b64 + " ", "base64").length;
    sink += atob(b64.slice(0, 40)).length;
    sink += Buffer.from(b64.replace(/\+/g, "-").replace(/\//g, "_"), "base64url").length;
    sink += Buffer.from("deadbeef", "hex").length;
    sink += Buffer.from([1, 2, 3]).toString("base64url").length;
    sink += Buffer.byteLength(b64, "base64");
    sink += btoa("x".repeat(30)).length;
    const { crypto } = await need("crypto");
    sink += crypto.createHash("sha256").update("x").digest("base64url").length;
    sink += crypto.createHash("sha1").update("y").digest("base64").length;
    sink += crypto.createHmac("sha256", "k").update("z").digest("hex").length;
  },
  async gap_socket_backpressure() {
    const { net } = await need("net");
    const srv = await servers();
    const c = net.connect(srv.echo, "127.0.0.1", () => {
      let w = 0;
      const chunk = Buffer.alloc(1 << 20, 97);
      const pump = () => {
        while (w < 16) {
          w++;
          if (!c.write(chunk)) {
            c.once("drain", pump);
            return;
          }
        }
        c.end();
      };
      pump();
    });
    let n = 0;
    c.on("data", d => {
      n += d.length;
      if (n > 4 << 20 && !c.isPaused()) {
        c.pause();
        setTimeout(() => c.resume(), 5);
      }
    });
    sink += await drained(c, "echo under backpressure");
  },
  async gap_bodies() {
    const req = new Request("https://example.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    sink += req.body instanceof ReadableStream ? 1 : 0;
    const rd = req.body.getReader();
    sink += (await rd.read()).value.length;
    const req2 = new Request("https://example.com/v1/x", { method: "PUT", body: new Blob(["blob body"]) });
    sink += (await new Response(req2.body).text()).length;
    const req3 = new Request("https://example.com/v1/y", { method: "POST", body: new Uint8Array([1, 2, 3]) });
    sink += req3.body ? 1 : 0;
    sink += req3.bodyUsed ? 0 : 1;
    sink += new Response(null).body === null;
    sink += new Request("https://example.com/").body === null;
    sink += (await new Response("").text()).length;
    const res = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("x"));
          c.close();
        },
      }),
    );
    sink += (await res.arrayBuffer()).byteLength;
  },
  async gap_tls_verify() {
    const { tls, crypto } = await need("tls", "crypto");
    const srv = await servers();
    for (let i = 0; i < 2; i++)
      await new Promise(r => {
        const c = tls.connect(
          { host: "127.0.0.1", port: srv.tls, servername: "localhost", rejectUnauthorized: false },
          () => {
            sink +=
              (c.authorized ? 1 : 0) +
              String(c.authorizationError).length +
              (c.getPeerCertificate(true)?.issuerCertificate ? 1 : 0);
            c.end();
          },
        );
        c.on("data", () => {});
        c.on("close", r);
        c.on("error", r);
      });
    sink += crypto.getCurves().length;
  },
  async gap_embedded_cjs() {
    // CommonJS modules embedded in the executable, required at runtime (plugins, lazily loaded helpers)
    const { module: mod } = await need("module");
    const req = mod.createRequire(import.meta.url);
    for (const name of ["./rt/r0.cjs", "./rt/r3.cjs"]) {
      // An entry point bundled with --format=esm is an ES module whose default export is its module.exports.
      const loaded = req(name);
      const m = loaded.default ?? loaded;
      sink += m.depth + m.names.length + m.run(2) + m.dir;
    }
    if (import.meta.require) sink += typeof import.meta.require("node:path").join;
  },
  async gap_globals_scan() {
    // lazily created globals and import.meta fields a CLI touches at startup
    sink += (typeof self).length;
    sink += (typeof FormData).length;
    sink += (typeof MessageChannel).length;
    sink += Date.now() % 7;
    sink += process.platform.length;
    sink += import.meta.dir.length;
    sink += import.meta.dirname?.length | 0;
    const spread = { ...[1, 2, 3] };
    sink += Object.keys(spread).length;
    sink += Object.values({ 0: "a", 1: "b" }).length;
    sink += Object.entries(["x"]).length;
    sink += JSON.stringify({ a: [1, { b: 2 }], c: "d" }, null, 2).length;
  },
  async gap_strings16() {
    let acc = 0;
    const keys = Object.keys({ "straße 日本": 1, "ÿ-ǆ": 2, "ключ": 3 });
    for (let i = 0; i < 200; i++) {
      const k = keys[i % 3];
      acc += k.toUpperCase().length + k.toLowerCase().length + ("ÿ" + i).toUpperCase().length;
      const o = {};
      o[k + i] = i;
      acc += Object.keys(o)[0].length;
    }
    const long = "abcdefghij".repeat(2000) + "needle-in-the-haystack-xyz";
    for (let i = 0; i < 50; i++)
      acc +=
        long.indexOf("needle-in-the-haystack") + long.lastIndexOf("hij-not-there") + long.includes("the-haystack-xy");
    const atomKeys = Object.keys({ helloWorldKey: 1, anotherKeyName: 2 });
    for (let i = 0; i < 300; i++) acc += atomKeys[i & 1].replace(/([A-Z])/g, m => "_" + m.toLowerCase()).length;
    sink += acc;
  },
  async gap_errors_misc() {
    let acc = 0;
    const prev = Error.prepareStackTrace;
    Error.prepareStackTrace = (err, frames) => `${err.name}: ${frames.length}`;
    Error.prepareStackTrace = prev;
    const e = new Error("lazy");
    acc += e.stack.split("\n").length;
    Error.captureStackTrace(e);
    acc += String(e.stack).length;
    for (const f of [
      () => new URL("::nope"),
      () => atob("%%"),
      () => new TextDecoder("bogus-enc"),
      () => structuredClone(() => {}),
      () => new Headers({ "bad header": "x" }),
    ]) {
      try {
        f();
      } catch (err) {
        acc += err.name.length;
      }
    }
    const { crypto } = await need("crypto");
    const x = new crypto.X509Certificate(await cert());
    acc += x.validTo.length;
    acc += x.validFrom.length;
    sink += acc;
  },
  async gap_spawn_empty() {
    // tool-style subprocesses whose output is empty, read after exit
    for (let i = 0; i < 3; i++) {
      const p = Bun.spawn(["/bin/sh", "-c", i ? "true" : "echo -n"], { stdout: "pipe", stderr: "pipe" });
      await p.exited;
      sink += (await new Response(p.stdout).text()).length + (await new Response(p.stderr).text()).length + p.exitCode;
    }
    const b = await base();
    const r = await fetch(b + "/empty");
    sink += r.status;
    sink += r.body ? 1 : 0;
    const h = await fetch(b + "/json", { method: "HEAD" });
    sink += h.status;
    sink += h.body ? 1 : 0;
  },
  async gap_object_misc() {
    let acc = 0;
    const c = structuredClone({ a: "text", b: ["y", "y", "日本"], n: 1 });
    acc += c.b.length;
    acc += c.a.length;
    const sp = [1, 2, 3];
    sp[50000] = 4;
    acc += sp.length;
    acc += [...new Response("x").headers].length;
    acc += [...new Request("https://example.com/").headers].length;
    new Function("o", "const { a, b: [x = 1] = [] } = o; let [p, ...q] = [a, x]; return p + q.length;");
    acc += Object.prototype.propertyIsEnumerable.call([1, 2], 0);
    acc += Object.prototype.propertyIsEnumerable.call("abc", 1);
    for (let i = 0; i < 20; i++) for (const k in i & 1 ? 5 : "ab") acc += k.length;
    sink += acc;
  },
  async gap_idle() {
    // a CLI waiting at its prompt: live sockets/watchers/servers/contexts plus garbage and finalizable objects from the work so
    // far, then a long quiet period (idle GC ticks, then the idle full collection after ~10 s of no growth)
    const { net, tls, vm, util, fs, path } = await need("net", "tls", "vm", "util", "fs", "path");
    const srv = await servers();
    const tmp = await tmpdir();
    const CERT = await cert();
    const live = [];
    live.push(net.connect(srv.echo, "127.0.0.1"));
    live[0].on("data", () => {});
    live[0].on("error", () => {});
    live[0].write("hold");
    const t = tls.connect({ host: "127.0.0.1", port: srv.tls, ca: CERT, servername: "localhost" });
    t.on("error", () => {});
    t.on("data", () => {});
    live.push(t);
    const server = net.createServer(() => {});
    const idleSock = await socketPath("idle.sock");
    await new Promise((resolve, reject) => server.once("error", reject).listen(idleSock, resolve));
    live.push(server);
    fs.mkdirSync(path.join(tmp, "w/sub"), { recursive: true });
    const w = fs.watch(path.join(tmp, "w"), { recursive: true }, () => {
      sink++;
    });
    live.push(w);
    live.push(vm.createContext({ keep: [1, 2, 3] }));
    live.push(
      new Int32Array(16),
      new Uint16Array(16),
      new BigInt64Array(4),
      new Int8Array(4),
      new Uint32Array(8),
      new Float64Array(8),
      new Proxy({}, {}),
    );
    const sinkw = Bun.file(path.join(tmp, "sink.log")).writer();
    sinkw.write("x");
    sinkw.flush();
    live.push(sinkw);
    fs.writeFileSync(path.join(tmp, "w/sub/f.txt"), "1");
    const { crypto, http, string_decoder } = await need("crypto", "http", "string_decoder");
    const bl = new net.BlockList();
    bl.addAddress("10.0.0.1");
    live.push(bl);
    const wf = path.join(tmp, "w/watched.txt");
    fs.writeFileSync(wf, "a");
    fs.watchFile(wf, { interval: 5000 }, () => {});
    live.push({ close: () => fs.unwatchFile(wf) });
    const agent = new http.Agent({ keepAlive: true });
    await new Promise(r =>
      http
        .get({ host: "127.0.0.1", port: srv.plain, path: "/keep", agent }, res => {
          res.resume();
          res.on("end", r);
        })
        .on("error", r),
    );
    live.push(agent);
    const regexJunk = [];
    for (let i = 0; i < 300; i++) regexJunk.push(new RegExp("k" + i + "(\\d+)|v" + i, i & 1 ? "g" : "i"));
    for (let i = 0; i < 40; i++) {
      const f = new Function(
        "a",
        `const t = (s, ...v) => s.raw.join("|") + v.length; return t\`x\${a}y${i}\` + [a, ${i}].map(z => z * 2).join(",");`,
      );
      f(i);
    }
    regexJunk.forEach(r => r.test("k1"));
    regexJunk.length = 0;
    for (let i = 0; i < 20; i++) {
      const sg = new Intl.Segmenter("en", { granularity: i & 1 ? "word" : "grapheme" });
      for (const x of sg.segment("hello world " + i)) sink += x.segment.length;
    }
    const evalKeep = [];
    for (let i = 0; i < 20; i++)
      evalKeep.push(
        (0, eval)(`(function tpl${i}(x) { return String.raw\`a\${x}b${i}\` + /x${i}+y/.test("xx${i}y"); })`),
      );
    let junk = [];
    for (let round = 0; round < 30; round++) {
      setImmediate(() => {
        sink++;
      });
      for (let i = 0; i < 4000; i++)
        junk.push({
          i,
          s: "s" + i,
          a: [i, i + 1],
          u: i % 100 === 0 ? new URL("https://x.test/" + i) : null,
          h: i % 200 === 0 ? new Headers({ a: String(i) }) : null,
          rq: i % 500 === 0 ? new Request("https://x.test/" + i, { method: "POST", body: "b" }) : null,
        });
      if (round % 3 === 0) {
        crypto.createHash("sha256").update("x").digest();
        crypto.createHmac("sha1", "k").update("y").digest();
        new crypto.X509Certificate(CERT);
        new TextEncoder();
        new string_decoder.StringDecoder("utf8");
        process.resourceUsage();
        new ReadableStream({
          start(c) {
            c.close();
          },
        });
        new RegExp("r" + round + "[a-z]+\\d", "g").test("rab1");
        (0, eval)("(function(){ return `t${1}` })")();
        fs.watch(path.join(tmp, "w")).close();
        evalKeep.forEach(f => f(round));
      }
      if (junk.length > 40000) junk = junk.slice(-1000);
      await new Promise(r => setImmediate(r));
    }
    for (let i = 0; i < 5; i++) {
      new TextEncoder();
      new URLSearchParams("a=" + i);
      new vm.Script("1+" + i);
      new AbortController();
      new Blob(["x"]).stream();
      structuredClone({ i });
      new Intl.NumberFormat("en");
      new DOMException("x");
      tls.createSecureContext({ ca: CERT });
    }
    for (let i = 0; i < 2; i++)
      await new Promise(r => {
        const c = net.connect(srv.echo, "127.0.0.1", () => c.end("bye"));
        c.on("data", () => {});
        c.on("close", r);
        c.on("error", r);
      });
    for (let i = 0; i < 2; i++)
      await new Promise(r => {
        const c = tls.connect({ host: "127.0.0.1", port: srv.tls, ca: CERT, servername: "localhost" }, () => c.end());
        c.on("data", () => {});
        c.on("close", r);
        c.on("error", r);
      });
    await fetch(`${await base()}/json`).then(r => r.arrayBuffer());
    const cp = Bun.spawn(["/bin/echo", "x"], { stdout: "pipe" });
    await cp.exited;
    sink += junk.length;
    junk = null;
    const keepAlive = setInterval(() => {
      sink++;
    }, 4000);
    await sleep(IDLE_MS);
    clearInterval(keepAlive);
    fs.writeFileSync(path.join(tmp, "w/sub/f.txt"), "2");
    await sleep(50);
    for (const x of live) {
      try {
        x.destroy?.() ?? x.close?.() ?? x.end?.();
      } catch {}
    }
    sink += util.inspect(process.memoryUsage()).length;
  },
};
export const checksum = () => sink;
