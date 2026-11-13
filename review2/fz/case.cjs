"use strict";
// One scenario of the differential trace fuzz. The same file runs under node and bun.
// argv[2]: base64 JSON scenario. Trace lines go to the file named by FZ_OUT (sync writes).
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const sc = JSON.parse(Buffer.from(process.argv[2], "base64").toString());
const W = process.env.FZ_WRITER || "/tmp/fz/w";
const fd = process.env.FZ_OUT ? fs.openSync(process.env.FZ_OUT, "a") : 1;
const log = s => fs.writeSync(fd, s + "\n");
const napBuf = new Int32Array(new SharedArrayBuffer(4));
const nap = ms => Atomics.wait(napBuf, 0, 0, ms);

function summ(c) {
  if (c === null) return "null";
  if (c === undefined) return "undefined";
  const s = typeof c === "string" ? c : Buffer.from(c).toString("latin1");
  let r = "";
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j < s.length && s[j] === s[i]) j++;
    r += s[i] + (j - i);
    i = j;
  }
  return r || "empty";
}

function sched(when, fn) {
  switch (when) {
    case "sync":
      return fn();
    case "tick":
      return void process.nextTick(fn);
    case "micro":
      return void queueMicrotask(fn);
    case "imm":
      return void setImmediate(fn);
    default: {
      const m = /^t(\d+)$/.exec(when);
      if (!m) throw new Error("bad when " + when);
      return void setTimeout(fn, +m[1]);
    }
  }
}
const wait = when =>
  new Promise(res => {
    if (when === "micro") res();
    else sched(when, res);
  });

process.on("exit", code => log(`process exit ${code}`));
if (sc.ue) process.on("uncaughtException", (e, origin) => log(`UE ${e && e.message} origin=${origin}`));
if (sc.ur) process.on("unhandledRejection", e => log(`UR ${e && e.message}`));

const child = spawn(W, sc.writer, { stdio: sc.stdio });
child.on("error", e => log(`child error ${e.code || e.message}`));
child.on("exit", (code, sig) => log(`child exit ${code} ${sig}`));
child.on("close", (code, sig) => log(`child close ${code} ${sig}`));

function setup(P, stream, cfg) {
  let n = 0;
  // A pipe nothing reads is not traced.
  if (!cfg) return;
  stream.on("end", () => log(`${P} end`));
  stream.on("close", () => log(`${P} close`));
  stream.on("error", e => log(`${P} error ${e && (e.code || e.message)}`));

  const handle = (chunk, via) => {
    const k = ++n;
    log(`${P} ${via}#${k} ${summ(chunk)}`);
    if (sc.markers) {
      process.nextTick(() => log(`${P} tick#${k}`));
      Promise.resolve().then(() => log(`${P} micro#${k}`));
    }
    run(cfg.actions[k - 1] || "none", k);
  };
  const onData = chunk => handle(chunk, "data");
  const onReadable = () => {
    log(`${P} readable`);
    let c;
    while ((c = stream.read()) !== null) handle(c, "read");
  };
  const onData2 = chunk => log(`${P} data2 ${summ(chunk)}`);

  function run(act, k) {
    const parts = act.split(":");
    switch (parts[0]) {
      case "none":
        return;
      case "pr":
        stream.pause();
        sched(parts[1], () => {
          log(`${P} resume@${k}`);
          stream.resume();
        });
        return;
      case "throw":
        throw new Error(`boom-${P}-${k}`);
      case "rr":
        stream.off("data", onData);
        sched(parts[1], () => {
          log(`${P} readd@${k}`);
          stream.on("data", onData);
        });
        return;
      case "read": {
        const r = stream.read(parts[1] === "all" ? undefined : +parts[1]);
        log(`${P} read(${parts[1]})@${k} -> ${summ(r)}`);
        return;
      }
      case "destroy":
        stream.destroy(parts[1] === "err" ? new Error(`destroyed-${P}-${k}`) : undefined);
        return;
      case "nap":
        nap(+parts[1]);
        return;
      case "kill":
        child.kill();
        return;
      case "async":
        // An async listener: the rest runs in its continuation.
        (async () => {
          await wait(parts[1]);
          log(`${P} cont@${k}`);
          run(parts.slice(2).join(":"), k);
        })();
        return;
      default:
        throw new Error("bad action " + act);
    }
  }

  const attach = () => {
    log(`${P} attach ${cfg.mode}`);
    switch (cfg.mode) {
      case "data":
        stream.on("data", onData);
        break;
      case "readable":
        stream.on("readable", onReadable);
        break;
      case "readable+data":
        stream.on("readable", onReadable);
        sched(cfg.second, () => {
          log(`${P} attach2`);
          stream.on("data", onData2);
        });
        break;
      case "readable-then-data":
        // 'readable' for the first event only, then a 'data' listener takes over.
        stream.once("readable", () => {
          log(`${P} readable1`);
          const c = stream.read();
          if (c !== null) handle(c, "read");
          sched(cfg.second, () => {
            log(`${P} attach2`);
            stream.on("data", onData);
          });
        });
        break;
      case "paused":
        stream.pause();
        stream.on("data", onData);
        sched(cfg.second, () => {
          log(`${P} resume0`);
          stream.resume();
        });
        break;
      case "iter":
        (async () => {
          try {
            for await (const c of stream) handle(c, "iter");
            log(`${P} iter done`);
          } catch (e) {
            log(`${P} iter threw ${e && e.message}`);
          }
        })();
        break;
      case "resume":
        stream.resume();
        break;
      case "none":
        break;
      default:
        throw new Error("bad mode " + cfg.mode);
    }
  };
  if (cfg.at === "spawn") child.once("spawn", attach);
  else if (cfg.at === "exit") child.once("exit", attach);
  else sched(cfg.at, attach);
}

if (child.stdout) setup("out", child.stdout, sc.pipes.out);
if (child.stderr) setup("err", child.stderr, sc.pipes.err);
if (sc.keep === "interval") {
  const t = setInterval(() => {}, 10);
  child.on("close", () => clearInterval(t));
}
if (sc.spawnNap) nap(sc.spawnNap);
