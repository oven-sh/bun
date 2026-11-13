// Userland model of "child.stdout / child.stderr are net.Sockets over the pipe fds" (the design asked for on #36316),
// built from what the runtime already does for stdio[3+]: the child's fd 1 and fd 2 are redirected to two extra
// "pipe" slots, which node:child_process wraps with net.connect({ fd }).
// What child_process.ts does NOT do for those sockets today is added here, each behind an option so its need can be shown:
//   count:  'close' waits for the two sockets (Node's _closesNeeded; PR #33614 for stdio[3+])
//   flush:  resume() unread sockets on the tick after 'exit' (Node's flushStdio)
//   hop:    deliver 'exit' after the current poll (setImmediate), so the sockets have read what the child wrote (PR #33614)
//   lazyRef: sockets are unref'd until something reads them (main's process lifetime, departure (a) of the PR under review)
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
function spawnFd(cmd, args = [], opts = {}) {
  const o = Object.assign({ count: true, flush: true, hop: false, lazyRef: false, extra: 0, stdin: "ignore" }, opts);
  const stdio = [o.stdin, "ignore", "ignore", "pipe", "pipe"]; for (let k = 0; k < o.extra; k++) stdio.push("pipe");
  const real = spawn("sh", ["-c", 'exec "$@" 1>&3 2>&4 3>&- 4>&-', "sh", cmd, ...args], { stdio });
  const child = new EventEmitter();
  child.real = real;
  child.pid = real.pid;
  child.stdout = real.stdio[3];
  child.stderr = real.stdio[4];
  child.stdio = [null, child.stdout, child.stderr];
  child.extra = real.stdio.slice(5);
  child.stdin = real.stdin;
  child.exitCode = null; child.signalCode = null;
  child.kill = s => real.kill(s);
  child.unref = () => real.unref();
  child.ref = () => real.ref();
  let need = o.count ? 3 : 1, got = 0;
  const maybeClose = () => { if (++got === need) child.emit("close", child.exitCode, child.signalCode); };
  if (o.count) for (const s of [child.stdout, child.stderr]) s.once("close", maybeClose);
  if (o.lazyRef) for (const s of [child.stdout, child.stderr]) {
    s.unref();
    const read = s._read;
    // the first _read() that a consumer causes (not the constructor's read(0)) refs it again
    let armed = false; process.nextTick(() => process.nextTick(() => (armed = true)));
    const on = s.on; let reffed = false;
    const refNow = () => { if (!reffed) { reffed = true; s.ref(); } };
    for (const m of ["on", "addListener", "once", "prependListener"]) { const f = s[m]; s[m] = function (ev, ...r) { if (ev === "data" || ev === "readable") refNow(); return f.call(this, ev, ...r); }; }
    for (const m of ["read", "resume", "pipe", "pause"]) { const f = s[m]; s[m] = function (...r) { if (armed) refNow(); return f.apply(this, r); }; }
  }
  const onExit = (code, sig) => {
    child.exitCode = code; child.signalCode = sig;
    child.emit("exit", code, sig);
    if (o.flush) process.nextTick(() => { for (const s of [child.stdout, child.stderr]) if (s.readable && !s.destroyed) s.resume(); });
    maybeClose();
  };
  real.on("exit", (code, sig) => (o.hop ? setImmediate(onExit, code, sig) : onExit(code, sig)));
  real.on("error", e => child.emit("error", e));
  return child;
}
module.exports = { spawnFd };
