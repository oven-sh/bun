// Default process warning printer, mirroring Node's lib/internal/process/warning.js
// onWarning. Invoked from BunProcess.cpp's doEmitWarning nextTick handler after
// the 'warning' event fires; it is not installed as a listener (so user
// listeners do not suppress the stderr report, matching Node where onWarning is
// just another listener alongside any user-installed ones).

const ErrorPrototypeToString = Error.prototype.toString;

let traceWarningHelperShown = false;

function hasExecFlag(flag: string): boolean {
  const argv = process.execArgv;
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) return true;
  return false;
}

function lazyBasename(p: string): string {
  let i = p.length;
  while (i > 0) {
    const c = p.charCodeAt(i - 1);
    if (c === 47 /* / */ || c === 92 /* \ */) break;
    i--;
  }
  let base = p.slice(i);
  if (process.platform === "win32" && base.length > 4 && base.slice(-4).toLowerCase() === ".exe") {
    base = base.slice(0, -4);
  }
  return base;
}

function writeOut(msg: string): void {
  const stderr = process.stderr;
  if (stderr && typeof stderr.write === "function") {
    stderr.write(msg + "\n");
  }
}

function onWarning(warning: Error): void {
  if (!(warning instanceof Error)) return;
  const isDeprecation = warning.name === "DeprecationWarning";
  if (isDeprecation && process.noDeprecation) return;
  const trace =
    (process as any).traceProcessWarnings ||
    hasExecFlag("--trace-warnings") ||
    (isDeprecation && ((process as any).traceDeprecation || hasExecFlag("--trace-deprecation")));
  let msg = `(${process.release?.name || "node"}:${process.pid}) `;
  const code = (warning as any).code;
  if (code) msg += `[${code}] `;
  let stack: unknown;
  if (trace && (stack = warning.stack)) {
    msg += `${stack}`;
  } else {
    let body: string;
    try {
      body = typeof warning.toString === "function" ? `${warning.toString()}` : ErrorPrototypeToString.$call(warning);
    } catch {
      body = ErrorPrototypeToString.$call(warning);
    }
    msg += body;
  }
  const detail = (warning as any).detail;
  if (typeof detail === "string") {
    msg += `\n${detail}`;
  }
  if (!trace && !traceWarningHelperShown) {
    const flag = isDeprecation ? "--trace-deprecation" : "--trace-warnings";
    const argv0 = lazyBasename(process.argv0 || "node");
    msg += `\n(Use \`${argv0} ${flag} ...\` to show where the warning was created)`;
    traceWarningHelperShown = true;
  }
  writeOut(msg);
}

export default {
  onWarning,
};
