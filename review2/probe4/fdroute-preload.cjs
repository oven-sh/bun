// Preload: routes the stdout/stderr "pipe" slots of node:child_process.spawn() over two extra "pipe" slots, which the
// runtime wraps with net.connect({ fd }) (the fd-backed net.Socket route). The real ChildProcess object is kept;
// added in JS: 'close' waits for those two sockets, and unread sockets are resumed on the tick after 'exit'.
// Inert in the `bun test` runner itself (only the scripts it spawns are rerouted). FDROUTE_HOP=1: deliver 'exit' after the poll.
if (typeof Bun !== "undefined" && /\.test\.[cm]?[jt]sx?$/.test(Bun.main)) return;
const cp = require("node:child_process");
const realSpawn = cp.spawn;
const HOP = process.env.FDROUTE_HOP === "1";
const LAZYREF = process.env.FDROUTE_LAZYREF === "1";
function fdSpawn(file, args, options) {
  if (!Array.isArray(args)) { options = args; args = []; }
  options = options || {};
  let stdio = options.stdio ?? "pipe";
  if (typeof stdio === "string") stdio = [stdio, stdio, stdio];
  stdio = [...stdio];
  while (stdio.length < 3) stdio.push(undefined);
  for (let i = 0; i < 3; i++) if (stdio[i] === undefined || stdio[i] === null) stdio[i] = "pipe";
  const out = stdio[1] === "pipe", err = stdio[2] === "pipe";
  if ((!out && !err) || options.shell || process.platform === "win32") return realSpawn.call(this, file, args, options);
  const real = [stdio[0], out ? "ignore" : stdio[1], err ? "ignore" : stdio[2], ...stdio.slice(3)];
  let outIdx = -1, errIdx = -1, redir = "";
  if (out) { outIdx = real.length; real.push("pipe"); redir += ` 1>&${outIdx}`; }
  if (err) { errIdx = real.length; real.push("pipe"); redir += ` 2>&${errIdx}`; }
  if (out) redir += ` ${outIdx}>&-`;
  if (err) redir += ` ${errIdx}>&-`;
  const child = realSpawn.call(this, "/bin/sh", ["-c", `exec "$@"${redir}`, "sh", file, ...args], { ...options, stdio: real });
  const realStdio = child.stdio;
  const outSock = out ? realStdio[outIdx] : child.stdout, errSock = err ? realStdio[errIdx] : child.stderr;
  const def = (name, value) => Object.defineProperty(child, name, { value, enumerable: true, configurable: true, writable: true });
  def("stdout", outSock); def("stderr", errSock);
  def("stdio", [realStdio[0], outSock, errSock, ...realStdio.slice(3, 3 + stdio.length - 3)]);
  def("spawnfile", file); def("spawnargs", [file, ...args]);
  const socks = [out && outSock, err && errSock].filter(Boolean);
  let pending = 0, closeArgs = null;
  const realEmit = child.emit;
  for (const s of socks) { pending++; s.once("close", () => { if (--pending === 0 && closeArgs) realEmit.apply(child, closeArgs); }); }
  if (LAZYREF) for (const s of socks) {
    s.unref(); let reffed = false; const refNow = () => { if (!reffed) { reffed = true; s.ref(); } };
    for (const m of ["on", "addListener", "once", "prependListener"]) { const f = s[m]; s[m] = function (ev, ...r) { if (ev === "data" || ev === "readable") refNow(); return f.call(this, ev, ...r); }; }
    let armed = false; process.nextTick(() => process.nextTick(() => (armed = true)));
    // read(0) is the Readable's own maybeReadMore and net's start of reading, not a consumer.
    for (const m of ["read", "resume", "pipe"]) { const f = s[m]; s[m] = function (...r) { if (armed && !(m === "read" && r[0] === 0)) refNow(); return f.apply(this, r); }; }
  }
  const flush = () => { for (const s of socks) if (s.readable && !s.destroyed) s.resume(); };
  child.emit = function (ev, ...a) {
    if (ev === "close" && pending > 0) { closeArgs = [ev, ...a]; return true; }
    if (ev === "exit") {
      if (HOP && !this.__hopped) { this.__hopped = true; setImmediate(() => child.emit(ev, ...a)); return true; }
      const r = realEmit.call(this, ev, ...a); process.nextTick(flush); return r;
    }
    return realEmit.call(this, ev, ...a);
  };
  return child;
}
cp.spawn = fdSpawn;
