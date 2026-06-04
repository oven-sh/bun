// Pre-user-code bootstrap. Required natively from
// VirtualMachine::reload_entry_point (via Bun__preExecutionBootstrap) when
// argv contains a Node.js `--trace-*` flag, before the entry module — main
// file, worker, or `-e` eval — is evaluated. Must stay cheap: one execArgv
// scan, bail early when nothing applies.

{
  const execArgv = process.execArgv;
  let catString: string | null = null;
  let filePattern: string | null = null;
  let stackTraceLimit: string | null = null;

  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i];
    if (arg === "--trace-events-enabled") {
      // Node alias: expands to `--trace-event-categories
      // v8,node,node.async_hooks` at this position; a later explicit
      // --trace-event-categories overrides it (and vice versa).
      catString = "v8,node,node.async_hooks";
    } else if (arg === "--trace-event-categories") {
      if (i + 1 < execArgv.length) catString = execArgv[++i];
    } else if (arg.startsWith("--trace-event-categories=")) {
      catString = arg.slice("--trace-event-categories=".length);
    } else if (arg === "--trace-event-file-pattern") {
      if (i + 1 < execArgv.length) filePattern = execArgv[++i];
    } else if (arg.startsWith("--trace-event-file-pattern=")) {
      filePattern = arg.slice("--trace-event-file-pattern=".length);
    } else if (arg === "--stack-trace-limit") {
      if (i + 1 < execArgv.length) stackTraceLimit = execArgv[++i];
    } else if (arg.startsWith("--stack-trace-limit=")) {
      stackTraceLimit = arg.slice("--stack-trace-limit=".length);
    }
  }

  if (stackTraceLimit !== null) {
    const limit = Number(stackTraceLimit);
    if (Number.isFinite(limit)) Error.stackTraceLimit = limit;
  }

  // CLI-driven tracing is main-thread only for now; worker trace aggregation
  // (shared file, per-worker tid) lands in a later phase.
  if (catString !== null && Bun.isMainThread) {
    require("internal/trace_events").initFromCli(catString, filePattern);
  }
}

export default {};
